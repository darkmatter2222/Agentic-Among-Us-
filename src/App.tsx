import { useEffect, useRef } from 'react';
import './App.css';
import { GameRenderer } from './rendering/GameRenderer';
import { Poly3MapRenderer } from './rendering/Poly3MapRenderer';
import { AIAgentVisualRenderer } from './rendering/AIAgentVisualRenderer';
import { AIAgentManager } from './engine/AIAgentManager';
import { WALKABLE_ZONES, LABELED_ZONES, TASKS } from './data/poly3-map';
import * as PIXI from 'pixi.js';

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cleanup = false;
    let gameRenderer: GameRenderer | null = null;
    let agentManager: AIAgentManager | null = null;
    
    const initGame = async () => {
      try {
        console.log('Initializing game...');
        
        if (!canvasRef.current) {
          console.error('Canvas ref is null');
          return;
        }
        
        // Initialize game renderer
        gameRenderer = new GameRenderer();
        await gameRenderer.initialize(canvasRef.current);
        console.log('Pixi initialized');
        
        if (cleanup) {
          gameRenderer.destroy();
          return;
        }
        
        // Get layers for rendering
        const layers = gameRenderer.getLayers();
        console.log('Layers initialized');
        
        // Render the new poly3 map
        console.log('Rendering poly3 map...');
        const mapRenderer = new Poly3MapRenderer();
        mapRenderer.renderMap();
        layers.map.addChild(mapRenderer.getContainer());
        
        // Initialize AI Agent Manager
        console.log('Initializing AI Agent Manager...');
        agentManager = new AIAgentManager({
          walkableZones: WALKABLE_ZONES,
          labeledZones: LABELED_ZONES,
          tasks: TASKS,
          numAgents: 8
        });
        
        // Create agent visual renderer
        const agentVisualRenderer = new AIAgentVisualRenderer();
        layers.players.addChild(agentVisualRenderer.getContainer());
        
        // Initialize all agents
        const agents = agentManager.getAgents();
        for (const agent of agents) {
          agentVisualRenderer.initializeAgent(agent);
        }
        
        console.log('AI agents initialized');
        
        // Center camera on the map
        const mapCenter = mapRenderer.getMapCenter();
        console.log('Map center:', mapCenter);
        
        gameRenderer.getCamera().setZoom(0.5);
        gameRenderer.getCamera().focusOn(mapCenter.x, mapCenter.y, false);
        
        console.log('Game initialization complete');
        
        // Start render loop
        let lastTime = Date.now();
        let frameCount = 0;
        const animate = () => {
          if (cleanup) return;
          
          const now = Date.now();
          const deltaTime = (now - lastTime) / 1000;
          lastTime = now;
          
          // Debug logging every 60 frames
          if (frameCount++ % 60 === 0) {
            console.log('DeltaTime:', deltaTime.toFixed(4), 'FPS:', (1/deltaTime).toFixed(1));
          }
          
          // Update AI agents
          agentManager?.update(deltaTime);
          
          // Update agent visuals
          if (agentManager) {
            agentVisualRenderer.updateAgents(agentManager.getAgents());
          }
          
          // Update map animations
          mapRenderer.update(deltaTime);
          
          // Update camera and renderer
          gameRenderer?.getCamera().update(deltaTime);
          gameRenderer?.update(deltaTime);
          
          requestAnimationFrame(animate);
        };
        animate();
        
      } catch (error) {
        console.error('Failed to initialize game:', error);
      }
    };
    
    initGame();
    
    return () => {
      cleanup = true;
      if (gameRenderer) {
        gameRenderer.destroy();
      }
    };
  }, []);

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      margin: 0, 
      padding: 0,
      background: '#000',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center'
    }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

export default App;

