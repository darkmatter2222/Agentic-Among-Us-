/**
 * Vision Renderer - 360° vision cones with wall occlusion and gradient fade
 */

import * as PIXI from 'pixi.js';
import type { Player, Wall, Position } from '../types/game.types';
import { PlayerState } from '../types/game.types';

export class VisionRenderer {
  private container: PIXI.Container;
  private visionGraphics: PIXI.Graphics;
  private walls: Wall[];
  private scale: number = 20;
  
  // Vision configuration
  private readonly VISION_RAYS: number = 360; // Ray density for smooth circles
  private readonly GRADIENT_START: number = 0.7; // Start fading at 70% of vision radius

  constructor(container: PIXI.Container, walls: Wall[]) {
    this.container = container;
    this.walls = walls;
    
    this.visionGraphics = new PIXI.Graphics();
    this.container.addChild(this.visionGraphics);
  }

  /**
   * Render vision for all players
   */
  renderVision(players: Map<string, Player>, settings: { crewVision: number, impostorVision: number, lightsOn: boolean }): void {
    this.visionGraphics.clear();
    
    players.forEach(player => {
      // Only living players have vision (ghosts see everything)
      if (player.state === PlayerState.ALIVE) {
        this.renderPlayerVision(player, settings);
      }
    });
  }

  /**
   * Render vision cone for a single player
   */
  private renderPlayerVision(player: Player, settings: { crewVision: number, impostorVision: number, lightsOn: boolean }): void {
    // Calculate vision radius based on role and lights
    let visionRadius = player.role === 'IMPOSTOR' ? settings.impostorVision : settings.crewVision;
    
    // Reduce vision during lights sabotage
    if (!settings.lightsOn && player.role !== 'IMPOSTOR') {
      visionRadius *= 0.25;
    }
    
    const visionRadiusPixels = visionRadius * this.scale;
    
    // Calculate vision polygon with wall occlusion
    const visionPolygon = this.calculateVisionPolygon(player.position, visionRadiusPixels);
    
    // Draw gradient vision cone
    this.drawGradientVision(player.position, visionPolygon, visionRadiusPixels);
  }

  /**
   * Calculate vision polygon using raycasting for wall occlusion
   */
  private calculateVisionPolygon(origin: Position, radius: number): Position[] {
    const points: Position[] = [];
    const angleStep = (Math.PI * 2) / this.VISION_RAYS;
    
    for (let i = 0; i < this.VISION_RAYS; i++) {
      const angle = i * angleStep;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      
      // Cast ray and find closest wall intersection
      const hitPoint = this.castRay(origin, dirX, dirY, radius);
      points.push(hitPoint);
    }
    
    return points;
  }

  /**
   * Cast a single ray and return hit point or max distance
   */
  private castRay(origin: Position, dirX: number, dirY: number, maxDistance: number): Position {
    let closestT = 1.0; // Normalized distance (0-1)
    
    // Check intersection with all walls
    for (const wall of this.walls) {
      const t = this.rayWallIntersection(origin, dirX, dirY, wall);
      if (t !== null && t < closestT) {
        closestT = t;
      }
    }
    
    // Return hit point
    return {
      x: origin.x + dirX * maxDistance / this.scale * closestT,
      y: origin.y + dirY * maxDistance / this.scale * closestT
    };
  }

  /**
   * Calculate ray-wall intersection using line-line intersection
   * Returns normalized t value (0-1) along ray, or null if no intersection
   */
  private rayWallIntersection(origin: Position, dirX: number, dirY: number, wall: Wall): number | null {
    // Ray: P = origin + t * dir
    // Wall: Q = start + s * (end - start), where 0 <= s <= 1
    
    const wallDX = wall.end.x - wall.start.x;
    const wallDY = wall.end.y - wall.start.y;
    
    const denominator = dirX * wallDY - dirY * wallDX;
    
    // Parallel or coincident
    if (Math.abs(denominator) < 0.0001) {
      return null;
    }
    
    const dx = wall.start.x - origin.x;
    const dy = wall.start.y - origin.y;
    
    const t = (dx * wallDY - dy * wallDX) / denominator;
    const s = (dx * dirY - dy * dirX) / denominator;
    
    // Check if intersection is valid
    if (t < 0 || s < 0 || s > 1) {
      return null;
    }
    
    return t;
  }

  /**
   * Draw vision with gradient fade
   */
  private drawGradientVision(origin: Position, polygon: Position[], radius: number): void {
    if (polygon.length < 3) return;
    
    // Create radial gradient texture
    const gradientRadius = radius;
    const gradientStartRadius = gradientRadius * this.GRADIENT_START;
    
    // Draw filled vision area with gradient
    // Pixi.js doesn't support radial gradients directly in Graphics,
    // so we'll use a simple solid fill with alpha for now
    // TODO: Implement proper radial gradient using texture/shader
    
    this.visionGraphics.moveTo(polygon[0].x * this.scale, polygon[0].y * this.scale);
    for (let i = 1; i < polygon.length; i++) {
      this.visionGraphics.lineTo(polygon[i].x * this.scale, polygon[i].y * this.scale);
    }
    this.visionGraphics.closePath();
    this.visionGraphics.fill({ color: 0xFFFFFF, alpha: 0.1 });
    
    // Draw gradient rings (approximation of radial gradient)
    const numRings = 5;
    for (let ring = 0; ring < numRings; ring++) {
      const ringRadius = gradientStartRadius + (gradientRadius - gradientStartRadius) * (ring / numRings);
      const nextRingRadius = gradientStartRadius + (gradientRadius - gradientStartRadius) * ((ring + 1) / numRings);
      const alpha = 0.1 * (1 - ring / numRings);
      
      // Filter polygon points within this ring
      const ringPolygon = polygon.filter(p => {
        const dist = Math.sqrt((p.x - origin.x) ** 2 + (p.y - origin.y) ** 2);
        return dist * this.scale >= ringRadius && dist * this.scale <= nextRingRadius;
      });
      
      if (ringPolygon.length >= 3) {
        this.visionGraphics.moveTo(ringPolygon[0].x * this.scale, ringPolygon[0].y * this.scale);
        for (let i = 1; i < ringPolygon.length; i++) {
          this.visionGraphics.lineTo(ringPolygon[i].x * this.scale, ringPolygon[i].y * this.scale);
        }
        this.visionGraphics.closePath();
        this.visionGraphics.fill({ color: 0x000000, alpha: alpha });
      }
    }
  }

  /**
   * Update walls when map changes
   */
  updateWalls(walls: Wall[]): void {
    this.walls = walls;
  }

  /**
   * Debug: Draw all walls
   */
  debugDrawWalls(): void {
    this.visionGraphics.clear();
    
    for (const wall of this.walls) {
      this.visionGraphics.moveTo(wall.start.x * this.scale, wall.start.y * this.scale);
      this.visionGraphics.lineTo(wall.end.x * this.scale, wall.end.y * this.scale);
      this.visionGraphics.stroke({ width: 2, color: 0xFF0000, alpha: 0.5 });
    }
  }
}
