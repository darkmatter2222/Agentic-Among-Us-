import { useEffect, useRef, useState, useCallback } from 'react';
import './App.css';
import { GameRenderer } from './rendering/GameRenderer';
import { Poly3MapRenderer } from './rendering/Poly3MapRenderer';
import { RoomLightingRenderer } from './rendering/RoomLightingRenderer';
import { AIAgentVisualRenderer } from './rendering/AIAgentVisualRenderer';
import { getSimulationClient } from './ai/SimulationClient';
import type { WorldSnapshot, SpeechEvent, GameTimerSnapshot } from '@shared/types/simulation.types.ts';
import type { LLMQueueStats } from '@shared/types/protocol.types.ts';
import type { LLMTraceEvent } from '@shared/types/llm-trace.types.ts';
import { AgentInfoPanel, type AgentSummary } from './components/AgentInfoPanel';
import { LLMTimelinePanel } from './components/LLMTimelinePanel';

// Maximum number of LLM trace events to keep in the timeline
const MAX_TRACE_EVENTS = 50;

// Vision distance in pixels (matches agent visionRadius config)
const AGENT_VISION_DISTANCE = 150;

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const latestSnapshotRef = useRef<WorldSnapshot | null>(null);
  const recentSpeechRef = useRef<SpeechEvent[]>([]);
  const gameRendererRef = useRef<GameRenderer | null>(null);
  const mapRendererRef = useRef<Poly3MapRenderer | null>(null);
  const lightingRendererRef = useRef<RoomLightingRenderer | null>(null);
  const agentVisualRendererRef = useRef<AIAgentVisualRenderer | null>(null);
  const animationFrameIdRef = useRef<number>(0);
  const disposedRef = useRef<boolean>(false);
  const initializingRef = useRef<boolean>(false);
  const [agentSummaries, setAgentSummaries] = useState<AgentSummary[]>([]);
  const [taskProgress, setTaskProgress] = useState(0);
  const [llmQueueStats, setLlmQueueStats] = useState<LLMQueueStats | undefined>(undefined);
  const [gameTimer, setGameTimer] = useState<GameTimerSnapshot | undefined>(undefined);
  const [panelWidth, setPanelWidth] = useState(380);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const [followingAgentId, setFollowingAgentId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  
  // Visibility toggle states (all enabled by default)
  const [showVisionBoxes, setShowVisionBoxes] = useState(false);
  const [showActionRadius, setShowActionRadius] = useState(false);
  const [showThinkingBubbles, setShowThinkingBubbles] = useState(true);
  const [showSpeechBubbles, setShowSpeechBubbles] = useState(true);
  const [lightsOn, setLightsOn] = useState(true);
  const [llmTraceEvents, setLlmTraceEvents] = useState<LLMTraceEvent[]>([]);
  const [leftPanelWidth, setLeftPanelWidth] = useState(340);
  
  // Kill audio - preload for instant playback
  const killAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastKnownBodiesRef = useRef<Set<string>>(new Set());

  // Preload kill sound on mount
  useEffect(() => {
    const audio = new Audio('/audio/among-us-kill.mp3');
    audio.preload = 'auto';
    audio.volume = 0.5;
    killAudioRef.current = audio;

    // Force load the audio
    audio.load();

    return () => {
      if (killAudioRef.current) {
        killAudioRef.current.pause();
        killAudioRef.current = null;
      }
    };
  }, []);

  // ResizeObserver to track viewport size changes and resize PIXI renderer
  useEffect(() => {
    const mapWrapper = mapWrapperRef.current;
    const gameRenderer = gameRendererRef.current;
    
    if (!mapWrapper) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && gameRendererRef.current) {
          gameRendererRef.current.resize(width, height);
        }
      }
    });
    
    resizeObserver.observe(mapWrapper);
    
    // Initial resize if renderer is ready
    if (gameRenderer) {
      const rect = mapWrapper.getBoundingClientRect();
      gameRenderer.resize(rect.width, rect.height);
    }
    
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    // Prevent double initialization during React Strict Mode or HMR
    if (initializingRef.current) {
      console.warn('[App] Already initializing, skipping...');
      return;
    }
    initializingRef.current = true;
    disposedRef.current = false;

    // Use singleton to preserve connection across HMR
    const simulationClient = getSimulationClient();

    let lastFrameTime = performance.now();
    let lastAppliedTick = -1;
    let lastSummaryAt = 0;

    const applyLatestSnapshot = () => {
      if (!agentVisualRendererRef.current) return;
      const snapshot = latestSnapshotRef.current;
      if (!snapshot) return;
      if (snapshot.tick === lastAppliedTick) return;
      agentVisualRendererRef.current.syncAgents(snapshot.agents, recentSpeechRef.current);
      lastAppliedTick = snapshot.tick;
      // Clear speech events after they've been processed
      recentSpeechRef.current = [];
    };

    const animate = () => {
      if (disposedRef.current) return;

      const now = performance.now();
      const deltaTime = (now - lastFrameTime) / 1000;
      lastFrameTime = now;

      applyLatestSnapshot();

      agentVisualRendererRef.current?.update(deltaTime);
      mapRendererRef.current?.update(deltaTime);
      lightingRendererRef.current?.update(deltaTime);
      gameRendererRef.current?.update(deltaTime);

      animationFrameIdRef.current = requestAnimationFrame(animate);
    };

    const initializeScene = async () => {
      if (!canvasRef.current) {
        console.error('Canvas ref is null');
        initializingRef.current = false;
        return;
      }
      
      // Check if already initialized (HMR scenario)
      if (gameRendererRef.current) {
        console.info('[App] Renderer already exists, reusing...');
        lastFrameTime = performance.now();
        animationFrameIdRef.current = requestAnimationFrame(animate);
        initializingRef.current = false;
        return;
      }

      const gameRenderer = new GameRenderer();
      await gameRenderer.initialize(canvasRef.current);
      gameRendererRef.current = gameRenderer;
      const layers = gameRenderer.getLayers();

      const mapRenderer = new Poly3MapRenderer();
      mapRenderer.renderMap();
      layers.map.addChild(mapRenderer.getContainer());
      mapRendererRef.current = mapRenderer;

      // Add ray-traced room lighting (above floor, below players)
      const lightingRenderer = new RoomLightingRenderer();
      lightingRenderer.renderLights();
      layers.map.addChild(lightingRenderer.getContainer());
      lightingRendererRef.current = lightingRenderer;

      const agentVisualRenderer = new AIAgentVisualRenderer();
      // Wire up lighting renderer for vision reduction and color confidence
      agentVisualRenderer.setLightingRenderer(lightingRenderer);
      layers.players.addChild(agentVisualRenderer.getContainer());
      agentVisualRendererRef.current = agentVisualRenderer;

      // Resize renderer to actual viewport size immediately
      const mapWrapper = mapWrapperRef.current;
      if (mapWrapper) {
        const rect = mapWrapper.getBoundingClientRect();
        gameRenderer.resize(rect.width, rect.height);
      }

      // Calculate initial zoom to fit the map using actual viewport
      const mapCenter = mapRenderer.getMapCenter();
      const bounds = mapRenderer.getMapBounds();
      const mapWidth = bounds.maxX - bounds.minX;
      const mapHeight = bounds.maxY - bounds.minY;

      // Get actual viewport size for zoom calculation
      const viewportRect = mapWrapper?.getBoundingClientRect();
      const viewportWidth = viewportRect?.width ?? 1920;
      const viewportHeight = viewportRect?.height ?? 1080;
      const padding = 0.90;

      const zoomX = (viewportWidth * padding) / mapWidth;
      const zoomY = (viewportHeight * padding) / mapHeight;
      const initialZoom = Math.min(zoomX, zoomY);

      const camera = gameRenderer.getCamera();
      camera.setZoom(initialZoom);
      camera.focusOn(mapCenter.x, mapCenter.y, false);

      lastFrameTime = performance.now();
      animationFrameIdRef.current = requestAnimationFrame(animate);
      initializingRef.current = false;
    };

    void initializeScene();

    const unsubscribeWorld = simulationClient.onWorldUpdate((snapshot) => {
      latestSnapshotRef.current = snapshot;

      // Capture speech events
      if (snapshot.recentSpeech && snapshot.recentSpeech.length > 0) {
        recentSpeechRef.current = snapshot.recentSpeech;
      }
      
      // Detect new kills and play sound
      // Debug: log bodies
      if (snapshot.bodies && snapshot.bodies.length > 0) {
        console.log(`[APP] Bodies detected: ${snapshot.bodies.length}`, snapshot.bodies.map(b => b.id));
      }
      
      if (snapshot.bodies && snapshot.bodies.length > 0) {
        const currentBodyIds = new Set(snapshot.bodies.map(b => b.id));
        const previousBodyIds = lastKnownBodiesRef.current;
        
        // Check for any new bodies
        for (const bodyId of currentBodyIds) {
          if (!previousBodyIds.has(bodyId)) {
            // New body detected - play kill sound
            if (killAudioRef.current) {
              killAudioRef.current.currentTime = 0;
              killAudioRef.current.play().catch(() => {
                // Ignore autoplay errors - user hasn't interacted yet
              });
            }
            break; // Only play once per update even if multiple new bodies
          }
        }
        
        lastKnownBodiesRef.current = currentBodyIds;
      }

      const now = performance.now();
      if (!disposedRef.current && (now - lastSummaryAt >= 200 || lastSummaryAt === 0)) {
        // Debug: log dead agents
        const deadAgents = snapshot.agents.filter(a => a.playerState === 'DEAD');
        if (deadAgents.length > 0) {
          console.log(`[APP] Dead agents: ${deadAgents.map(a => a.id).join(', ')}`);
        }
        
        setAgentSummaries(
          snapshot.agents.map(agent => ({
            id: agent.id,
            color: agent.color,
            activityState: agent.activityState,
            currentZone: agent.currentZone,
            locationState: agent.locationState,
            goal: agent.currentGoal,
            playerState: agent.playerState,
            // Extended data
            role: agent.role,
            currentThought: agent.currentThought,
            recentSpeech: agent.recentSpeech,
            assignedTasks: agent.assignedTasks,
            tasksCompleted: agent.tasksCompleted ?? 0,
            visibleAgentIds: agent.visibleAgentIds,
            // Memory & Suspicion data
            suspicionLevels: agent.suspicionLevels,
            memoryContext: agent.memoryContext,
            suspicionContext: agent.suspicionContext,
            recentConversations: agent.recentConversations,
            isBeingFollowed: agent.isBeingFollowed,
            buddyId: agent.buddyId,
            // Kill status (impostors only)
            killStatus: agent.killStatus,
          }))
        );
        setTaskProgress(snapshot.taskProgress ?? 0);
        setLlmQueueStats(snapshot.llmQueueStats);
        setGameTimer(snapshot.gameTimer);
        lastSummaryAt = now;
      }
    });

    const unsubscribeConnection = simulationClient.onConnectionStateChange((state) => {
      console.info('[simulation] connection state:', state);
      // Only clear agents on stale connection if we haven't reconnected within a reasonable time
      // The reconnecting state will automatically attempt to reconnect
      if (state === 'stale' && !disposedRef.current) {
        // Keep the last known state visible while reconnecting
        console.info('[simulation] connection stale, keeping UI state while reconnecting...');
      }
    });

    // Subscribe to LLM trace events for the timeline panel
    const unsubscribeLLMTrace = simulationClient.onLLMTrace((trace) => {
      console.debug('[App] LLM trace event received:', trace.id, trace.agentName);
      setLlmTraceEvents((prev) => {
        const updated = [trace, ...prev];
        // Keep only the most recent MAX_TRACE_EVENTS
        return updated.slice(0, MAX_TRACE_EVENTS);
      });
    });

    // Only connect if not already connected (singleton may already be connected)
    if (!simulationClient.isConnected()) {
      simulationClient.connect();
    }

    return () => {
      disposedRef.current = true;
      unsubscribeWorld();
      unsubscribeConnection();
      unsubscribeLLMTrace();
      // DON'T disconnect the singleton - it should persist across HMR
      // simulationClient.disconnect();

      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = 0;
      }

      // DON'T destroy renderers during HMR - they will be reused
      // Only clean up if this is a true unmount (page unload)
      // agentVisualRendererRef.current?.destroy();
      // gameRendererRef.current?.destroy();
      
      initializingRef.current = false;
    };
  }, []);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      
      // Add document-level mouseup to ensure panning stops even if mouse leaves canvas
      const handleDocumentMouseUp = () => {
        setIsPanning(false);
        document.removeEventListener('mouseup', handleDocumentMouseUp);
      };
      document.addEventListener('mouseup', handleDocumentMouseUp);
    }
  }, []);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning && gameRendererRef.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;

      // Stop following when user pans
      if ((dx !== 0 || dy !== 0) && followingAgentId) {
        setFollowingAgentId(null);
        gameRendererRef.current.getCamera().stopFollowing();
      }

      gameRendererRef.current.panCamera(dx, dy);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }

    // Check if hovering over an agent's action radius for cursor feedback
    if (gameRendererRef.current && latestSnapshotRef.current) {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const cssMouseX = e.clientX - rect.left;
      const cssMouseY = e.clientY - rect.top;

      // Convert CSS canvas coordinates to PIXI stage coordinates
      const stageCoords = gameRendererRef.current.cssToStageCoords(cssMouseX, cssMouseY);

      const camera = gameRendererRef.current.getCamera();
      const transform = camera.getTransform();
      const worldX = (stageCoords.x - transform.x) / transform.scale;
      const worldY = (stageCoords.y - transform.y) / transform.scale;

      const agents = latestSnapshotRef.current.agents;
      const hoveredAgent = agents.find(agent => {
        // Positions are already in pixels (same coordinate space as the map)
        const agentX = agent.movement.position.x;
        const agentY = agent.movement.position.y;
        const dist = Math.sqrt((worldX - agentX) ** 2 + (worldY - agentY) ** 2);
        // actionRadius is also in pixels
        return dist < agent.actionRadius;
      });

      // Update cursor style
      const canvas = e.target as HTMLElement;
      canvas.style.cursor = hoveredAgent ? 'pointer' : (isPanning ? 'grabbing' : 'grab');
    }
  }, [isPanning, followingAgentId]);  const handleCanvasMouseUp = useCallback((e: React.MouseEvent) => {
    // Only select agent on click (not drag)
    const dx = Math.abs(e.clientX - lastMousePos.current.x);
    const dy = Math.abs(e.clientY - lastMousePos.current.y);
    const wasDragging = dx > 5 || dy > 5;

    if (!wasDragging && gameRendererRef.current && latestSnapshotRef.current) {
      // Get click position relative to canvas (CSS pixels)
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const cssClickX = e.clientX - rect.left;
      const cssClickY = e.clientY - rect.top;

      // Convert CSS canvas coordinates to PIXI stage coordinates
      const stageCoords = gameRendererRef.current.cssToStageCoords(cssClickX, cssClickY);

      // Convert screen position to world position
      const camera = gameRendererRef.current.getCamera();
      const transform = camera.getTransform();
      const worldX = (stageCoords.x - transform.x) / transform.scale;
      const worldY = (stageCoords.y - transform.y) / transform.scale;

      // Find clicked agent (check within agent's action radius)
      const agents = latestSnapshotRef.current.agents;
      const clickedAgent = agents.find(agent => {
        // Positions are already in pixels (same coordinate space as the map)
        const agentX = agent.movement.position.x;
        const agentY = agent.movement.position.y;
        const dist = Math.sqrt((worldX - agentX) ** 2 + (worldY - agentY) ** 2);
        // actionRadius is also in pixels
        return dist < agent.actionRadius;
      });

      if (clickedAgent) {
        // Select and follow the clicked agent
        setSelectedAgentId(clickedAgent.id);
        setFollowingAgentId(clickedAgent.id);

        // Calculate zoom level based on vision distance using actual viewport
        const mapWrapper = mapWrapperRef.current;
        const viewportRect = mapWrapper?.getBoundingClientRect();
        const viewportSize = viewportRect 
          ? Math.min(viewportRect.width, viewportRect.height)
          : 800; // fallback
        // AGENT_VISION_DISTANCE is in pixels
        const targetZoom = (viewportSize * 0.4) / (AGENT_VISION_DISTANCE * 2);

        // Viewport center is already set by resize, just set zoom
        camera.setZoom(Math.min(Math.max(targetZoom, 0.5), 2.5));

        // Start following the agent - position is already in pixels
        const agentPos = { x: clickedAgent.movement.position.x, y: clickedAgent.movement.position.y };
        camera.followPlayer(agentPos);
      }
    }

    setIsPanning(false);
  }, []);  const handleCanvasMouseLeave = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (gameRendererRef.current) {
      const camera = gameRendererRef.current.getCamera();
      const currentZoom = camera.zoom;

      // Use multiplicative zoom for consistent feel across all zoom levels
      // Zooming out: multiply by ~0.9, zooming in: multiply by ~1.1
      // This makes zoom feel linear regardless of current zoom level
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = currentZoom * zoomFactor;

      // Get cursor position relative to canvas (CSS pixels)
      const rect = e.currentTarget.getBoundingClientRect();
      const cssCursorX = e.clientX - rect.left;
      const cssCursorY = e.clientY - rect.top;

      // Convert CSS canvas coordinates to PIXI stage coordinates
      const stageCoords = gameRendererRef.current.cssToStageCoords(cssCursorX, cssCursorY);

      // Zoom at cursor position (in PIXI stage coordinates)
      gameRendererRef.current.zoomAtPoint(newZoom, stageCoords.x, stageCoords.y);

      // Stop following when user zooms
      if (followingAgentId) {
        setFollowingAgentId(null);
        camera.stopFollowing();
      }
    }
  }, [followingAgentId]);const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingPanel(true);
  }, []);

  useEffect(() => {
    if (!isDraggingPanel) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      setPanelWidth(Math.max(200, Math.min(600, newWidth)));
    };

    const handleMouseUp = () => {
      setIsDraggingPanel(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingPanel]);

  // Update follow target position when following an agent
  useEffect(() => {
    if (!followingAgentId) return;
    
    const updateFollowTarget = () => {
      const snapshot = latestSnapshotRef.current;
      const agent = snapshot?.agents.find(a => a.id === followingAgentId);
      const camera = gameRendererRef.current?.getCamera();
      
        if (agent && camera && camera.isFollowing()) {
          const followTarget = camera.getFollowTarget();
          if (followTarget) {
            // Position is already in pixels
            followTarget.x = agent.movement.position.x;
            followTarget.y = agent.movement.position.y;
          }
        }
      };    // Update every frame
    const intervalId = setInterval(updateFollowTarget, 16);
    return () => clearInterval(intervalId);
  }, [followingAgentId]);

  const handleCenterMap = useCallback(() => {
    const gameRenderer = gameRendererRef.current;
    const mapRenderer = mapRendererRef.current;
    const mapWrapper = mapWrapperRef.current;
    if (!gameRenderer || !mapRenderer || !mapWrapper) return;

    // Stop following when centering map
    if (followingAgentId) {
      setFollowingAgentId(null);
      gameRenderer.getCamera().stopFollowing();
    }

    // Get map bounds in map pixel coordinates
    const bounds = mapRenderer.getMapBounds();
    const mapWidth = bounds.maxX - bounds.minX;
    const mapHeight = bounds.maxY - bounds.minY;
    const mapCenterX = (bounds.minX + bounds.maxX) / 2;
    const mapCenterY = (bounds.minY + bounds.maxY) / 2;

    // Get actual viewport size (the visible area)
    const viewportRect = mapWrapper.getBoundingClientRect();
    const viewportWidth = viewportRect.width;
    const viewportHeight = viewportRect.height;
    const padding = 0.90; // 90% of viewport

    // Calculate zoom to fit entire map into the actual viewport
    const zoomX = (viewportWidth * padding) / mapWidth;
    const zoomY = (viewportHeight * padding) / mapHeight;
    const zoom = Math.min(zoomX, zoomY);

    console.log('[CenterMap] Viewport size:', viewportWidth, 'x', viewportHeight);
    console.log('[CenterMap] Map size:', mapWidth, 'x', mapHeight);
    console.log('[CenterMap] Calculated zoom:', zoom);

    const camera = gameRenderer.getCamera();

    // Viewport center is already set by resize, just set zoom and focus
    camera.setZoom(zoom);
    camera.focusOn(mapCenterX, mapCenterY, false);
  }, [followingAgentId]);// Toggle handlers for visibility controls
  const handleToggleVisionBoxes = useCallback(() => {
    setShowVisionBoxes(prev => {
      const newValue = !prev;
      agentVisualRendererRef.current?.toggleVisionBoxes(newValue);
      return newValue;
    });
  }, []);

  const handleToggleActionRadius = useCallback(() => {
    setShowActionRadius(prev => {
      const newValue = !prev;
      agentVisualRendererRef.current?.toggleActionRadius(newValue);
      return newValue;
    });
  }, []);

  const handleToggleThinkingBubbles = useCallback(() => {
    setShowThinkingBubbles(prev => {
      const newValue = !prev;
      agentVisualRendererRef.current?.toggleThinkingBubbles(newValue);
      return newValue;
    });
  }, []);

  const handleToggleSpeechBubbles = useCallback(() => {
    setShowSpeechBubbles(prev => {
      const newValue = !prev;
      agentVisualRendererRef.current?.toggleSpeechBubbles(newValue);
      return newValue;
    });
  }, []);

  const handleToggleLights = useCallback(() => {
    setLightsOn(prev => {
      const newValue = !prev;
      lightingRendererRef.current?.setLightsEnabled(newValue);
      return newValue;
    });
  }, []);

  // Handle agent selection - zoom in and follow
  const handleAgentSelect = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    setFollowingAgentId(agentId);

    // Find agent position and start following
    const snapshot = latestSnapshotRef.current;
    const agent = snapshot?.agents.find(a => a.id === agentId);
    const gameRenderer = gameRendererRef.current;
    const mapWrapper = mapWrapperRef.current;
    if (!agent || !gameRenderer || !mapWrapper) return;

    const camera = gameRenderer.getCamera();
    
    // Get actual viewport size
    const viewportRect = mapWrapper.getBoundingClientRect();
    const viewportSize = Math.min(viewportRect.width, viewportRect.height);

    // Calculate zoom level based on vision distance
    // We want the vision circle to fill about 40% of the viewport
    // AGENT_VISION_DISTANCE is in pixels
    const targetZoom = (viewportSize * 0.4) / (AGENT_VISION_DISTANCE * 2);

    // Viewport center is already set by resize, just set zoom
    camera.setZoom(Math.min(Math.max(targetZoom, 0.5), 2.5));

    // Create a position object that we'll update each frame - position is already in pixels
    const agentPos = { x: agent.movement.position.x, y: agent.movement.position.y };
    camera.followPlayer(agentPos);
  }, []);// Handle stop following
  const handleStopFollowing = useCallback(() => {
    setFollowingAgentId(null);
    gameRendererRef.current?.getCamera().stopFollowing();
    handleCenterMap();
  }, [handleCenterMap]);

  return (
    <div className="app-shell">
      <LLMTimelinePanel 
        width={leftPanelWidth}
        events={llmTraceEvents}
      />
      <div className="map-wrapper" ref={mapWrapperRef}>
        <div className="controls-panel">
          <button className="control-btn" onClick={handleCenterMap} title="Center & fit map">
            ⊙
          </button>
          <div className="control-divider" />
          <button 
            className={`control-btn ${lightsOn ? 'active' : ''}`} 
            onClick={handleToggleLights} 
            title="Toggle Lights (Sabotage)"
          >
            💡
          </button>
          <div className="control-divider" />
          <button 
            className={`control-btn ${showVisionBoxes ? 'active' : ''}`} 
            onClick={handleToggleVisionBoxes} 
            title="Toggle Vision Boxes"
          >
            👁
          </button>
          <button 
            className={`control-btn ${showActionRadius ? 'active' : ''}`} 
            onClick={handleToggleActionRadius} 
            title="Toggle Action Radius"
          >
            ◎
          </button>
          <button 
            className={`control-btn ${showThinkingBubbles ? 'active' : ''}`} 
            onClick={handleToggleThinkingBubbles} 
            title="Toggle Thinking Bubbles"
          >
            💭
          </button>
          <button 
            className={`control-btn ${showSpeechBubbles ? 'active' : ''}`} 
            onClick={handleToggleSpeechBubbles} 
            title="Toggle Speech Bubbles"
          >
            💬
          </button>
        </div>
        {/* Game Timer Display */}
        {gameTimer && (
          <div className={`game-timer ${gameTimer.remainingMs < 120000 ? 'urgent' : gameTimer.remainingMs < 300000 ? 'warning' : ''}`}>
            <span className="timer-icon">⏱️</span>
            <span className="timer-value">
              {Math.floor(gameTimer.remainingMs / 60000)}:{String(Math.floor((gameTimer.remainingMs % 60000) / 1000)).padStart(2, '0')}
            </span>
          </div>
        )}
        {followingAgentId && (
          <button 
            className="stop-following-btn" 
            onClick={handleStopFollowing}
            title="Stop following agent"
          >
            ✕
          </button>
        )}
        <div
          className={`map-canvas ${isPanning ? 'panning' : ''}`}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseLeave}
          onWheel={handleWheel}
        >
          <canvas ref={canvasRef} />
        </div>
      </div>
      <div
        className="panel-resize-handle"
        onMouseDown={handleResizeMouseDown}
      />
      <AgentInfoPanel 
        agents={agentSummaries} 
        width={panelWidth} 
        taskProgress={taskProgress}
        selectedAgentId={selectedAgentId}
        onAgentSelect={handleAgentSelect}
        llmQueueStats={llmQueueStats}
      />
    </div>
  );
}

export default App;