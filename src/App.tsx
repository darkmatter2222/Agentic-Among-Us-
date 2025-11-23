import { useEffect, useRef } from 'react';
import './App.css';
import { GameRenderer } from './rendering/GameRenderer';
import { VectorMapRenderer } from './rendering/VectorMapRenderer';
import type { Player } from './types/game.types';
import { PlayerRole, PlayerState } from './types/game.types';
import * as PIXI from 'pixi.js';

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cleanup = false;
    let gameRenderer: GameRenderer | null = null;
    
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
        
        // Render the vector-based map
        console.log('Rendering vector map...');
        const vectorMapRenderer = new VectorMapRenderer();
        vectorMapRenderer.renderMap();
        layers.map.addChild(vectorMapRenderer.getContainer());
        
        // Create and render demo players
        console.log('Creating demo players...');
        const demoPlayers = createDemoPlayers();
        
        // Render players (PlayerRenderer expects a container in constructor)
        // We'll add player sprites directly for now
        demoPlayers.forEach(player => {
          const sprite = createSimplePlayerSprite(player);
          layers.players.addChild(sprite);
        });
        
        // Center camera on the map
        gameRenderer.getCamera().focusOn(30, 20, false);
        
        console.log('Game initialization complete');
        
        // Start render loop
        let lastTime = Date.now();
        const animate = () => {
          if (cleanup) return;
          
          const now = Date.now();
          const deltaTime = (now - lastTime) / 1000;
          lastTime = now;
          
          // Update animations
          vectorMapRenderer.update(deltaTime);
          
          // Update camera
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

// Simple player sprite creation (temporary until we integrate PlayerRenderer properly)
function createSimplePlayerSprite(player: Player): PIXI.Container {
  const container = new PIXI.Container();
  const scale = 20; // 1 unit = 20 pixels
  
  container.position.set(player.position.x * scale, player.position.y * scale);
  
  // Player body (circle)
  const graphics = new PIXI.Graphics();
  const colorMap: Record<string, number> = {
    red: 0xFF0000,
    blue: 0x0000FF,
    green: 0x00FF00,
    pink: 0xFF69B4,
    orange: 0xFFA500,
    yellow: 0xFFFF00,
    black: 0x000000,
    white: 0xFFFFFF
  };
  
  const color = colorMap[player.color] || 0xFF0000;
  graphics.circle(0, 0, 0.4 * scale);
  graphics.fill({ color, alpha: 0.9 });
  graphics.stroke({ width: 2, color: 0x000000 });
  
  container.addChild(graphics);
  
  // Player name label
  const nameText = new PIXI.Text({
    text: player.name,
    style: {
      fontFamily: 'Arial',
      fontSize: 12,
      fill: 0xFFFFFF,
      stroke: { color: 0x000000, width: 3 }
    }
  });
  nameText.anchor.set(0.5);
  nameText.position.set(0, -0.8 * scale);
  container.addChild(nameText);
  
  return container;
}

// Create demo players for testing
function createDemoPlayers(): Player[] {
  const playerData: Array<{ id: string; name: string; color: string; x: number; y: number; role: PlayerRole }> = [
    { id: '1', name: 'Red', color: 'red', x: 27, y: 20, role: PlayerRole.CREWMATE },
    { id: '2', name: 'Blue', color: 'blue', x: 13, y: 28, role: PlayerRole.IMPOSTOR },
    { id: '3', name: 'Green', color: 'green', x: 5, y: 26, role: PlayerRole.CREWMATE },
    { id: '4', name: 'Pink', color: 'pink', x: 36, y: 23, role: PlayerRole.CREWMATE },
    { id: '5', name: 'Orange', color: 'orange', x: 13, y: 16, role: PlayerRole.CREWMATE },
    { id: '6', name: 'Yellow', color: 'yellow', x: 51, y: 29, role: PlayerRole.CREWMATE },
    { id: '7', name: 'Black', color: 'black', x: 5, y: 14, role: PlayerRole.IMPOSTOR },
    { id: '8', name: 'White', color: 'white', x: 42, y: 11, role: PlayerRole.CREWMATE },
  ];

  return playerData.map(data => ({
    id: data.id,
    name: data.name,
    role: data.role,
    state: PlayerState.ALIVE,
    position: { x: data.x, y: data.y },
    velocity: { x: 0, y: 0 },
    color: data.color,
    visionRadius: data.role === PlayerRole.IMPOSTOR ? 7.0 : 5.0,
    speed: 1.0,
    tasks: [],
    killCooldown: 25000,
    lastKillTime: 0,
    killRange: 1.8,
    isInVent: false,
    emergencyMeetingsRemaining: 1,
    hasVoted: false,
    suspicionLevels: new Map(),
    knownInformation: [],
    trustNetwork: new Map(),
    lastSeenLocations: new Map(),
    planningQueue: []
  }));
}

export default App;

