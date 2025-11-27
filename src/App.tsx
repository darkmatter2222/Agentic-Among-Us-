import { useEffect, useRef, useState, useCallback } from 'react';
import './App.css';
import { GameRenderer } from './rendering/GameRenderer';
import { Poly3MapRenderer } from './rendering/Poly3MapRenderer';
import { AIAgentVisualRenderer } from './rendering/AIAgentVisualRenderer';
import { SimulationClient } from './ai/SimulationClient';
import type { WorldSnapshot, SpeechEvent } from '@shared/types/simulation.types.ts';
import { AgentInfoPanel, type AgentSummary } from './components/AgentInfoPanel';

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestSnapshotRef = useRef<WorldSnapshot | null>(null);
  const recentSpeechRef = useRef<SpeechEvent[]>([]);
  const gameRendererRef = useRef<GameRenderer | null>(null);
  const mapRendererRef = useRef<Poly3MapRenderer | null>(null);
  const [agentSummaries, setAgentSummaries] = useState<AgentSummary[]>([]);
  const [taskProgress, setTaskProgress] = useState(0);
  const [panelWidth, setPanelWidth] = useState(380);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let disposed = false;

    const gameRenderer = new GameRenderer();
    let mapRenderer: Poly3MapRenderer | null = null;
    let agentVisualRenderer: AIAgentVisualRenderer | null = null;
    const simulationClient = new SimulationClient();

    let animationFrameId = 0;
    let lastFrameTime = performance.now();
    let lastAppliedTick = -1;
    let lastSummaryAt = 0;

    const applyLatestSnapshot = () => {
      if (!agentVisualRenderer) return;
      const snapshot = latestSnapshotRef.current;
      if (!snapshot) return;
      if (snapshot.tick === lastAppliedTick) return;
      agentVisualRenderer.syncAgents(snapshot.agents, recentSpeechRef.current);
      lastAppliedTick = snapshot.tick;
      // Clear speech events after they've been processed
      recentSpeechRef.current = [];
    };

    const animate = () => {
      if (disposed) return;

      const now = performance.now();
      const deltaTime = (now - lastFrameTime) / 1000;
      lastFrameTime = now;

      applyLatestSnapshot();

      agentVisualRenderer?.update(deltaTime);
      mapRenderer?.update(deltaTime);
      gameRenderer.update(deltaTime);

      animationFrameId = requestAnimationFrame(animate);
    };

    const initializeScene = async () => {
      if (!canvasRef.current) {
        console.error('Canvas ref is null');
        return;
      }

      await gameRenderer.initialize(canvasRef.current);
      gameRendererRef.current = gameRenderer;
      const layers = gameRenderer.getLayers();

      mapRenderer = new Poly3MapRenderer();
      mapRenderer.renderMap();
      layers.map.addChild(mapRenderer.getContainer());
      mapRendererRef.current = mapRenderer;

      agentVisualRenderer = new AIAgentVisualRenderer();
      layers.players.addChild(agentVisualRenderer.getContainer());

      const mapCenter = mapRenderer.getMapCenter();
      gameRenderer.getCamera().setZoom(0.5);
      gameRenderer.getCamera().focusOn(mapCenter.x, mapCenter.y, false);

      lastFrameTime = performance.now();
      animationFrameId = requestAnimationFrame(animate);
    };

    void initializeScene();

    const unsubscribeWorld = simulationClient.onWorldUpdate((snapshot) => {
      latestSnapshotRef.current = snapshot;
      
      // Capture speech events
      if (snapshot.recentSpeech && snapshot.recentSpeech.length > 0) {
        recentSpeechRef.current = snapshot.recentSpeech;
      }

      const now = performance.now();
      if (!disposed && (now - lastSummaryAt >= 200 || lastSummaryAt === 0)) {
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
      if (state === 'stale' && !disposed) {
        setAgentSummaries([]);
      }
    });

    simulationClient.connect();

    return () => {
      disposed = true;
      unsubscribeWorld();
      unsubscribeConnection();
      simulationClient.disconnect();

      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      agentVisualRenderer?.destroy();
      mapRenderer = null;
      gameRenderer.destroy();
    };
  }, []);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning && gameRendererRef.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      gameRendererRef.current.panCamera(dx, dy);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  }, [isPanning]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleCanvasMouseLeave = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (gameRendererRef.current) {
      const camera = gameRendererRef.current.getCamera();
      const currentZoom = camera.zoom;
      const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
      camera.setZoom(currentZoom + zoomDelta);
    }
  }, []);

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

  const handleCenterMap = useCallback(() => {
    const gameRenderer = gameRendererRef.current;
    const mapRenderer = mapRendererRef.current;
    if (!gameRenderer || !mapRenderer) return;

    const bounds = mapRenderer.getMapBounds();
    const mapWidth = bounds.maxX - bounds.minX;
    const mapHeight = bounds.maxY - bounds.minY;
    const mapCenter = mapRenderer.getMapCenter();

    // Get canvas dimensions (Pixi uses 1920x1080 internal)
    const canvasWidth = 1920;
    const canvasHeight = 1080;

    // Calculate zoom to fit with some padding
    const padding = 0.9; // 90% of view
    const zoomX = (canvasWidth * padding) / mapWidth;
    const zoomY = (canvasHeight * padding) / mapHeight;
    const zoom = Math.min(zoomX, zoomY, 1.5); // Cap at 1.5x

    const camera = gameRenderer.getCamera();
    camera.setZoom(zoom);
    camera.focusOn(mapCenter.x, mapCenter.y, true);
  }, []);

  return (
    <div className="app-shell">
      <div className="map-wrapper">
        <button className="center-map-btn" onClick={handleCenterMap} title="Center & fit map">
          ⊙
        </button>
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
      <AgentInfoPanel agents={agentSummaries} width={panelWidth} taskProgress={taskProgress} />
    </div>
  );
}

export default App;

