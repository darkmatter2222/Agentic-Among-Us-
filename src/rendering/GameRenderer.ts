/**
 * Game Renderer using Pixi.js
 * Handles all visual rendering for the Among Us AI simulation
 */

import * as PIXI from 'pixi.js';
import type { GameState } from '@shared/types/game.types';

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
   * Get the PIXI stage dimensions (logical resolution)
   */
  getStageSize(): { width: number; height: number } {
    return {
      width: this.app.screen.width,
      height: this.app.screen.height
    };
  }

  /**
   * Get the canvas element's actual display size in CSS pixels
   */
  getCanvasDisplaySize(): { width: number; height: number } {
    const canvas = this.app.canvas;
    return {
      width: canvas.clientWidth,
      height: canvas.clientHeight
    };
  }

  /**
   * Convert CSS canvas coordinates (from mouse events) to PIXI stage coordinates
   * This accounts for the CSS scaling of the canvas
   */
  cssToStageCoords(cssX: number, cssY: number): { x: number; y: number } {
    const displaySize = this.getCanvasDisplaySize();
    const stageSize = this.getStageSize();
    
    // Scale factor from CSS pixels to PIXI stage pixels
    const scaleX = stageSize.width / displaySize.width;
    const scaleY = stageSize.height / displaySize.height;
    
    return {
      x: cssX * scaleX,
      y: cssY * scaleY
    };
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
   * Zoom at a specific screen point
   */
  zoomAtPoint(zoom: number, pivotX: number, pivotY: number): void {
    this.camera.zoomAtPoint(zoom, pivotX, pivotY);
  }

  /**
   * Focus camera on position
   */
  focusOn(x: number, y: number, smooth: boolean = true): void {
    this.camera.focusOn(x, y, smooth);
  }

  /**
   * Resize the renderer to fit a new viewport size
   * This updates both the PIXI renderer and the camera's viewport center
   */
  resize(width: number, height: number): void {
    if (!this.initialized) return;

    // Resize the PIXI renderer
    this.app.renderer.resize(width, height);

    // Update the stage hit area
    this.app.stage.hitArea = this.app.screen;

    // Update camera's viewport center to the new center
    this.camera.setViewportCenter(width / 2, height / 2);
  }  /**
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
export class Camera {
  x: number = 0;
  y: number = 0;
  zoom: number = 1.0;

  private targetX: number = 0;
  private targetY: number = 0;
  private targetZoom: number = 1.0;

  private smoothing: number = 0.1; // Lerp factor
  private following: boolean = false;
  private followTarget?: { x: number; y: number };

  // Default PIXI stage center (1920x1080), can be overridden for custom viewports
  private viewportCenterX = 960;
  private viewportCenterY = 540;

  constructor() {
    // Center camera initially at default PIXI stage center
    this.x = this.viewportCenterX;
    this.y = this.viewportCenterY;
    this.targetX = this.x;
    this.targetY = this.y;
  }

  /**
   * Set the viewport center point (in PIXI stage coordinates)
   * This should be called when centering/fitting to account for actual viewport size
   */
  setViewportCenter(centerX: number, centerY: number): void {
    this.viewportCenterX = centerX;
    this.viewportCenterY = centerY;
  }

  update(_deltaTime: number): void {
    if (this.following && this.followTarget) {
      // Center follow target in the viewport
      this.targetX = -this.followTarget.x * this.zoom + this.viewportCenterX;
      this.targetY = -this.followTarget.y * this.zoom + this.viewportCenterY;
    }

    // Smooth interpolation
    this.x += (this.targetX - this.x) * this.smoothing;
    this.y += (this.targetY - this.y) * this.smoothing;
    this.zoom += (this.targetZoom - this.zoom) * this.smoothing;
  }  getTransform(): { x: number; y: number; scale: number } {
    return {
      x: this.x,
      y: this.y,
      scale: this.zoom
    };
  }

  setZoom(zoom: number): void {
    this.targetZoom = Math.max(0.1, Math.min(5.0, zoom));
  }

  /**
   * Zoom towards a specific point (for zooming at cursor)
   * @param zoom New zoom level
   * @param pivotX Screen X coordinate to zoom towards
   * @param pivotY Screen Y coordinate to zoom towards  
   */
  zoomAtPoint(zoom: number, pivotX: number, pivotY: number): void {
    const oldZoom = this.zoom;
    const newZoom = Math.max(0.1, Math.min(5.0, zoom));
    
    if (newZoom === oldZoom) return;
    
    // Calculate the world position under the cursor before zoom
    const worldX = (pivotX - this.x) / oldZoom;
    const worldY = (pivotY - this.y) / oldZoom;
    
    // Calculate new camera position to keep cursor at same world position
    const newX = pivotX - worldX * newZoom;
    const newY = pivotY - worldY * newZoom;
    
    this.targetZoom = newZoom;
    this.targetX = newX;
    this.targetY = newY;
    this.following = false;
  }

  pan(dx: number, dy: number): void {
    this.following = false;
    this.targetX += dx;
    this.targetY += dy;
  }

  focusOn(x: number, y: number, smooth: boolean = true): void {
    // x and y are world coordinates (map pixels)
    // Center them in the viewport
    const zoomToUse = this.targetZoom;
    const screenX = -x * zoomToUse + this.viewportCenterX;
    const screenY = -y * zoomToUse + this.viewportCenterY;

    if (smooth) {
      this.targetX = screenX;
      this.targetY = screenY;
    } else {
      this.x = screenX;
      this.y = screenY;
      this.targetX = screenX;
      this.targetY = screenY;
      this.zoom = zoomToUse;
    }
    this.following = false;
  }

  followPlayer(player: { x: number; y: number }): void {
    this.following = true;
    this.followTarget = player;
  }

  stopFollowing(): void {
    this.following = false;
    this.followTarget = undefined;
  }

  isFollowing(): boolean {
    return this.following;
  }

  getFollowTarget(): { x: number; y: number } | undefined {
    return this.followTarget;
  }

  reset(): void {
    this.focusOn(24, 18, true); // Center of cafeteria
    this.setZoom(1.0);
  }
}
