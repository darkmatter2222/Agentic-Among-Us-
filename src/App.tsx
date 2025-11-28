import { useEffect, useRef, useState, useCallback } from 'react';
import './App.css';
import { GameRenderer } from './rendering/GameRenderer';
import { Poly3MapRenderer } from './rendering/Poly3MapRenderer';
import { RoomLightingRenderer } from './rendering/RoomLightingRenderer';
import { AIAgentVisualRenderer } from './rendering/AIAgentVisualRenderer';
import { getSimulationClient } from './ai/SimulationClient';
import type { WorldSnapshot, SpeechEvent } from '@shared/types/simulation.types.ts';
import { AgentInfoPanel, type AgentSummary } from './components/AgentInfoPanel';

// Vision distance in pixels (matches agent visionRadius config)
const AGENT_VISION_DISTANCE = 150;

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

      const mapCenter = mapRenderer.getMapCenter();
      gameRenderer.getCamera().setZoom(0.5);
      gameRenderer.getCamera().focusOn(mapCenter.x, mapCenter.y, false);

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

      const now = performance.now();
      if (!disposedRef.current && (now - lastSummaryAt >= 200 || lastSummaryAt === 0)) {
        setAgentSummaries(
          snapshot.agents.map(agent => ({
            id: agent.id,
            color: agent.color,
            activityState: agent.activityState,
            currentZone: agent.currentZone,
            locationState: agent.locationState,
            goal: agent.currentGoal,
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
          }))
        );
        setTaskProgress(snapshot.taskProgress ?? 0);
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

    // Only connect if not already connected (singleton may already be connected)
    if (!simulationClient.isConnected()) {
      simulationClient.connect();
    }

    return () => {
      disposedRef.current = true;
      unsubscribeWorld();
      unsubscribeConnection();
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
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const camera = gameRendererRef.current.getCamera();
      const transform = camera.getTransform();
      const worldX = (mouseX - transform.x) / transform.scale;
      const worldY = (mouseY - transform.y) / transform.scale;

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
      // Get click position relative to canvas
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Convert screen position to world position
      const camera = gameRendererRef.current.getCamera();
      const transform = camera.getTransform();
      const worldX = (clickX - transform.x) / transform.scale;
      const worldY = (clickY - transform.y) / transform.scale;

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

        // Calculate zoom level based on vision distance
        const canvasSize = Math.min(1920, 1080);
        // AGENT_VISION_DISTANCE is in pixels
        const targetZoom = (canvasSize * 0.4) / (AGENT_VISION_DISTANCE * 2);

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
      const zoomDelta = e.deltaY > 0 ? -0.15 : 0.15;
      const newZoom = currentZoom + zoomDelta;
      
      // Get cursor position relative to canvas
      const rect = e.currentTarget.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      
      // Zoom at cursor position
      gameRendererRef.current.zoomAtPoint(newZoom, cursorX, cursorY);
      
      // Stop following when user zooms
      if (followingAgentId) {
        setFollowingAgentId(null);
        camera.stopFollowing();
      }
    }
  }, [followingAgentId]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
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
    const canvas = canvasRef.current;
    if (!gameRenderer || !mapRenderer || !canvas) return;

    // Stop following when centering map
    if (followingAgentId) {
      setFollowingAgentId(null);
      gameRenderer.getCamera().stopFollowing();
    }

    const bounds = mapRenderer.getMapBounds();
    const mapWidth = bounds.maxX - bounds.minX;
    const mapHeight = bounds.maxY - bounds.minY;
    const mapCenterX = (bounds.minX + bounds.maxX) / 2;
    const mapCenterY = (bounds.minY + bounds.maxY) / 2;

    // Get actual visible canvas dimensions (excludes the agent panel)
    const canvasRect = canvas.getBoundingClientRect();
    const visibleWidth = canvasRect.width;
    const visibleHeight = canvasRect.height;

    // Calculate zoom to fit entire map with some padding in the VISIBLE area
    const padding = 0.90; // 90% of visible view
    const zoomX = (visibleWidth * padding) / mapWidth;
    const zoomY = (visibleHeight * padding) / mapHeight;
    const zoom = Math.min(zoomX, zoomY); // Use the smaller zoom to fit everything

    const camera = gameRenderer.getCamera();
    camera.setZoom(zoom);

    // Use the viewport-aware focus method that centers in the actual visible area
    camera.focusOnWithViewport(mapCenterX, mapCenterY, visibleWidth, visibleHeight, true);
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
      if (!agent || !gameRendererRef.current) return;

      const camera = gameRendererRef.current.getCamera();

      // Calculate zoom level based on vision distance
      // We want the vision circle to fill about 40% of the screen
      const canvasSize = Math.min(1920, 1080);
      // AGENT_VISION_DISTANCE is in pixels
      const targetZoom = (canvasSize * 0.4) / (AGENT_VISION_DISTANCE * 2);

      camera.setZoom(Math.min(Math.max(targetZoom, 0.5), 2.5));

      // Create a position object that we'll update each frame - position is already in pixels
      const agentPos = { x: agent.movement.position.x, y: agent.movement.position.y };
      camera.followPlayer(agentPos);
    }, []);  // Handle stop following
  const handleStopFollowing = useCallback(() => {
    setFollowingAgentId(null);
    gameRendererRef.current?.getCamera().stopFollowing();
    handleCenterMap();
  }, [handleCenterMap]);

  return (
    <div className="app-shell">
      <div className="map-wrapper">
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
      />
    </div>
  );
}

export default App;