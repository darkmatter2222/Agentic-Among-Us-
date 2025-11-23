/**
 * Game Renderer using Pixi.js
 * Handles all visual rendering for the Among Us AI simulation
 */

import * as PIXI from 'pixi.js';
import type { GameState } from '../types/game.types';

export class GameRenderer {
  private app: PIXI.Application;
  private layers: Map<string, PIXI.Container>;
  private camera: Camera;
  private scale: number = 20; // 1 game unit = 20 pixels
  private initialized: boolean = false;
  
  constructor() {
    // Initialize Pixi.js Application
    this.app = new PIXI.Application();
    
    this.layers = new Map();
    this.camera = new Camera();
  }

  async initialize(canvasElement: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      canvas: canvasElement,
      width: 1920,
      height: 1080,
      backgroundColor: 0x000000,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Set up the stage
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    
    // Initialize layers after app is ready
    this.initializeLayers();
    
    this.initialized = true;
  }

  private initializeLayers(): void {
    const layerNames = [
      'background',
      'map',
      'shadows',
      'objects',
      'players',
      'vision',
      'ui'
    ];

    layerNames.forEach((name, index) => {
      const layer = new PIXI.Container();
      layer.zIndex = index;
      layer.label = name;
      this.layers.set(name, layer);
      this.app.stage.addChild(layer);
    });

    // Enable sorting
    this.app.stage.sortableChildren = true;
  }

  getLayer(name: string): PIXI.Container | undefined {
    return this.layers.get(name);
  }

  getLayers(): { background: PIXI.Container; map: PIXI.Container; shadows: PIXI.Container; objects: PIXI.Container; players: PIXI.Container; vision: PIXI.Container; ui: PIXI.Container } {
    return {
      background: this.layers.get('background')!,
      map: this.layers.get('map')!,
      shadows: this.layers.get('shadows')!,
      objects: this.layers.get('objects')!,
      players: this.layers.get('players')!,
      vision: this.layers.get('vision')!,
      ui: this.layers.get('ui')!
    };
  }

  /**
   * Update camera and apply transform to stage
   */
  update(deltaTime: number): void {
    this.camera.update(deltaTime);
    const transform = this.camera.getTransform();
    
    // Apply camera transform to stage
    this.app.stage.position.set(transform.x, transform.y);
    this.app.stage.scale.set(transform.scale);
  }

  /**
   * Get the camera for external control
   */
  getCamera(): Camera {
    return this.camera;
  }

  /**
   * Convert game coordinates to screen pixels
   */
  gameToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: x * this.scale + this.camera.x,
      y: y * this.scale + this.camera.y
    };
  }

  /**
   * Convert screen pixels to game coordinates
   */
  screenToGame(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - this.camera.x) / this.scale,
      y: (y - this.camera.y) / this.scale
    };
  }

  /**
   * Update camera position
   */
  updateCamera(deltaTime: number): void {
    this.camera.update(deltaTime);
    
    // Apply camera transform to all game layers
    const transform = this.camera.getTransform();
    ['map', 'shadows', 'objects', 'players', 'vision'].forEach(layerName => {
      const layer = this.layers.get(layerName);
      if (layer) {
        layer.position.set(transform.x, transform.y);
        layer.scale.set(transform.scale, transform.scale);
      }
    });
  }

  /**
   * Main render loop
   */
  render(_gameState: GameState, deltaTime: number): void {
    this.updateCamera(deltaTime);
    // Rendering happens automatically via Pixi's ticker
  }

  /**
   * Get the Pixi app instance
   */
  getApp(): PIXI.Application {
    return this.app;
  }

  /**
   * Get current scale (pixels per game unit)
   */
  getScale(): number {
    return this.scale * this.camera.zoom;
  }

  /**
   * Set zoom level
   */
  setZoom(zoom: number): void {
    this.camera.setZoom(zoom);
  }

  /**
   * Pan camera by delta
   */
  panCamera(dx: number, dy: number): void {
    this.camera.pan(dx, dy);
  }

  /**
   * Focus camera on position
   */
  focusOn(x: number, y: number, smooth: boolean = true): void {
    this.camera.focusOn(x, y, smooth);
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.initialized && this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.layers.clear();
      this.initialized = false;
    }
  }
}

/**
 * Camera controller for panning and zooming
 */
class Camera {
  x: number = 0;
  y: number = 0;
  zoom: number = 1.0;
  
  private targetX: number = 0;
  private targetY: number = 0;
  private targetZoom: number = 1.0;
  
  private smoothing: number = 0.1; // Lerp factor
  private following: boolean = false;
  private followTarget?: { x: number; y: number };

  constructor() {
    // Center camera initially
    this.x = 960; // Half of 1920
    this.y = 540; // Half of 1080
    this.targetX = this.x;
    this.targetY = this.y;
  }

  update(_deltaTime: number): void {
    if (this.following && this.followTarget) {
      this.targetX = -this.followTarget.x * 20 * this.zoom + 960;
      this.targetY = -this.followTarget.y * 20 * this.zoom + 540;
    }

    // Smooth interpolation
    this.x += (this.targetX - this.x) * this.smoothing;
    this.y += (this.targetY - this.y) * this.smoothing;
    this.zoom += (this.targetZoom - this.zoom) * this.smoothing;
  }

  getTransform(): { x: number; y: number; scale: number } {
    return {
      x: this.x,
      y: this.y,
      scale: this.zoom
    };
  }

  setZoom(zoom: number): void {
    this.targetZoom = Math.max(0.5, Math.min(3.0, zoom));
  }

  pan(dx: number, dy: number): void {
    this.following = false;
    this.targetX += dx;
    this.targetY += dy;
  }

  focusOn(x: number, y: number, smooth: boolean = true): void {
    const screenX = -x * 20 * this.zoom + 960;
    const screenY = -y * 20 * this.zoom + 540;
    
    if (smooth) {
      this.targetX = screenX;
      this.targetY = screenY;
    } else {
      this.x = screenX;
      this.y = screenY;
      this.targetX = screenX;
      this.targetY = screenY;
    }
  }

  followPlayer(player: { x: number; y: number }): void {
    this.following = true;
    this.followTarget = player;
  }

  stopFollowing(): void {
    this.following = false;
    this.followTarget = undefined;
  }

  reset(): void {
    this.focusOn(24, 18, true); // Center of cafeteria
    this.setZoom(1.0);
  }
}
