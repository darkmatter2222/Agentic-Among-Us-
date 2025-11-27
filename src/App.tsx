import { useEffect, useRef, useState } from 'react';
import './App.css';
import { GameRenderer } from './rendering/GameRenderer';
import { Poly3MapRenderer } from './rendering/Poly3MapRenderer';
import { AIAgentVisualRenderer } from './rendering/AIAgentVisualRenderer';
import { SimulationClient } from './ai/SimulationClient';
import type { WorldSnapshot } from '@shared/types/simulation.types.ts';
import { AgentInfoPanel, type AgentSummary } from './components/AgentInfoPanel';

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestSnapshotRef = useRef<WorldSnapshot | null>(null);
  const [agentSummaries, setAgentSummaries] = useState<AgentSummary[]>([]);

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
      agentVisualRenderer.syncAgents(snapshot.agents);
      lastAppliedTick = snapshot.tick;
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
      const layers = gameRenderer.getLayers();

      mapRenderer = new Poly3MapRenderer();
      mapRenderer.renderMap();
      layers.map.addChild(mapRenderer.getContainer());

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

      const now = performance.now();
      if (!disposed && (now - lastSummaryAt >= 200 || lastSummaryAt === 0)) {
        setAgentSummaries(
          snapshot.agents.map(agent => ({
            id: agent.id,
            activityState: agent.activityState,
            currentZone: agent.currentZone,
            locationState: agent.locationState,
            goal: agent.currentGoal
          }))
        );
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

  return (
    <div className="app-shell">
      <div className="map-wrapper">
        <div className="map-canvas">
          <canvas ref={canvasRef} />
        </div>
      </div>
      <AgentInfoPanel agents={agentSummaries} />
    </div>
  );
}

export default App;

