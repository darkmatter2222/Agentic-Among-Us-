import { useEffect, useRef } from 'react';
import './App.css';
import { GameRenderer } from './rendering/GameRenderer';
import { Poly3MapRenderer } from './rendering/Poly3MapRenderer';
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
        
        // Render the new poly3 map
        console.log('Rendering poly3 map...');
        const mapRenderer = new Poly3MapRenderer();
        mapRenderer.renderMap();
        layers.map.addChild(mapRenderer.getContainer());
        
        // Create and render demo players
        console.log('Creating demo players...');
        const demoPlayers = createDemoPlayers();
        
        // Render players (PlayerRenderer expects a container in constructor)
        // We'll add player sprites directly for now
        demoPlayers.forEach(player => {
          const sprite = createSimplePlayerSprite(player);
          layers.players.addChild(sprite);
        });
        
        // Center camera on the map (using map's center point)
        const mapCenter = mapRenderer.getMapCenter();
        console.log('Map center:', mapCenter);
        
        // Set appropriate zoom for the pixel-based map
        // The map is about 2400x1300 pixels, so zoom out to 0.5 to see more
        gameRenderer.getCamera().setZoom(0.5);
        gameRenderer.getCamera().focusOn(mapCenter.x, mapCenter.y, false);
        
        console.log('Game initialization complete');
        
        // Start render loop
        let lastTime = Date.now();
        const animate = () => {
          if (cleanup) return;
          
          const now = Date.now();
          const deltaTime = (now - lastTime) / 1000;
          lastTime = now;
          
          // Update animations
          mapRenderer.update(deltaTime);
          
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
  // No scale needed - positions are already in pixels from the map data
  
  container.position.set(player.position.x, player.position.y);
  
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
  const playerRadius = 15; // Player size in pixels
  graphics.circle(0, 0, playerRadius);
  graphics.fill({ color, alpha: 0.9 });
  graphics.stroke({ width: 2, color: 0x000000 });
  
  container.addChild(graphics);
  
  // Player name label
  const nameText = new PIXI.Text({
    text: player.name,
    style: {
      fontFamily: 'Arial',
      fontSize: 14,
      fill: 0xFFFFFF,
      stroke: { color: 0x000000, width: 3 }
    }
  });
  nameText.anchor.set(0.5);
  nameText.position.set(0, -25);
  container.addChild(nameText);
  
  return container;
}

// Create demo players for testing - positions in pixel coordinates
function createDemoPlayers(): Player[] {
  const playerData: Array<{ id: string; name: string; color: string; x: number; y: number; role: PlayerRole }> = [
    { id: '1', name: 'Red', color: 'red', x: 1500, y: 500, role: PlayerRole.CREWMATE },       // Cafeteria
    { id: '2', name: 'Blue', color: 'blue', x: 1200, y: 1000, role: PlayerRole.IMPOSTOR },    // Electrical
    { id: '3', name: 'Green', color: 'green', x: 450, y: 800, role: PlayerRole.CREWMATE },    // Reactor
    { id: '4', name: 'Pink', color: 'pink', x: 2100, y: 1200, role: PlayerRole.CREWMATE },    // Shields
    { id: '5', name: 'Orange', color: 'orange', x: 1150, y: 700, role: PlayerRole.CREWMATE }, // MedBay
    { id: '6', name: 'Yellow', color: 'yellow', x: 2550, y: 800, role: PlayerRole.CREWMATE }, // Navigation
    { id: '7', name: 'Black', color: 'black', x: 650, y: 1150, role: PlayerRole.IMPOSTOR },   // Lower Engine
    { id: '8', name: 'White', color: 'white', x: 2100, y: 450, role: PlayerRole.CREWMATE },   // Weapons
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

