/**
 * Vision Box Renderer
 * Renders box-shaped field of view with wall occlusion (ray tracing)
 * More accurate to Among Us original vision system
 */

import * as PIXI from 'pixi.js';
import type { Point } from '@shared/data/poly3-map.ts';
import { POLY3_MAP_DATA } from '@shared/data/poly3-map.ts';

export interface VisionBoxConfig {
  size: number;       // Half-size of the vision box (box extends ±size from player)
  color: number;
  alpha: number;
  rayCount: number;   // Number of rays per side for wall occlusion
}

interface Edge {
  start: Point;
  end: Point;
}

export class VisionBoxRenderer {
  private container: PIXI.Container;
  private graphics: PIXI.Graphics;
  private config: VisionBoxConfig;
  private walls: Edge[] = [];
  
  constructor(config?: Partial<VisionBoxConfig>) {
    this.container = new PIXI.Container();
    this.graphics = new PIXI.Graphics();
    this.container.addChild(this.graphics);
    
    this.config = {
      size: 150,
      color: 0xFFFFFF,
      alpha: 0.15,
      rayCount: 90, // rays per corner for smooth edges
      ...config
    };
    
    // Extract wall edges from map data
    this.extractWallsFromMap();
  }
  
  /**
   * Extract wall edges from walkable zone boundaries and holes
   */
  private extractWallsFromMap(): void {
    this.walls = [];
    
    for (const zone of POLY3_MAP_DATA.walkableZones) {
      // Add outer boundary edges
      const vertices = zone.vertices;
      for (let i = 0; i < vertices.length; i++) {
        const start = vertices[i];
        const end = vertices[(i + 1) % vertices.length];
        this.walls.push({ start, end });
      }
      
      // Add hole (obstacle) edges
      for (const hole of zone.holes) {
        for (let i = 0; i < hole.length; i++) {
          const start = hole[i];
          const end = hole[(i + 1) % hole.length];
          this.walls.push({ start, end });
        }
      }
    }
  }
  
  /**
   * Ray-line segment intersection
   * Returns distance to intersection or null if no hit
   */
  private rayIntersect(
    originX: number, originY: number,
    dirX: number, dirY: number,
    p1x: number, p1y: number,
    p2x: number, p2y: number
  ): number | null {
    const dx = p2x - p1x;
    const dy = p2y - p1y;
    
    const denom = dirX * dy - dirY * dx;
    if (Math.abs(denom) < 0.0001) return null; // Parallel
    
    const t = ((p1x - originX) * dy - (p1y - originY) * dx) / denom;
    const s = ((p1x - originX) * dirY - (p1y - originY) * dirX) / denom;
    
    if (t > 0.001 && s >= 0 && s <= 1) {
      return t;
    }
    return null;
  }
  
  /**
   * Cast a ray and find the closest wall hit within max distance
   */
  private castRay(originX: number, originY: number, dirX: number, dirY: number, maxDist: number): number {
    let closest = maxDist;
    
    for (const wall of this.walls) {
      const dist = this.rayIntersect(
        originX, originY, dirX, dirY,
        wall.start.x, wall.start.y,
        wall.end.x, wall.end.y
      );
      if (dist !== null && dist < closest) {
        closest = dist;
      }
    }
    
    return closest;
  }
  
  /**
   * Generate vision polygon with wall occlusion
   * Uses ray tracing to find visible area within the box
   */
  private generateVisionPolygon(position: Point): Point[] {
    const { size, rayCount } = this.config;
    const points: Point[] = [];
    
    // Total rays around 360 degrees, more rays = smoother edges
    const totalRays = rayCount * 4;
    
    for (let i = 0; i < totalRays; i++) {
      const angle = (i / totalRays) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      
      // Calculate max distance to box edge in this direction
      // For a box of half-size 'size', we need to find where the ray exits
      let maxDist: number;
      
      // Calculate intersection with axis-aligned box
      const tX = dirX !== 0 ? size / Math.abs(dirX) : Infinity;
      const tY = dirY !== 0 ? size / Math.abs(dirY) : Infinity;
      maxDist = Math.min(tX, tY);
      
      // Cast ray and get actual distance (may be blocked by wall)
      const actualDist = this.castRay(position.x, position.y, dirX, dirY, maxDist);
      
      points.push({
        x: position.x + dirX * actualDist,
        y: position.y + dirY * actualDist
      });
    }
    
    return points;
  }
  
  /**
   * Render vision box at a position
   */
  render(position: Point, _facing?: number): void {
    this.graphics.clear();
    
    const { color, alpha } = this.config;
    
    // Generate vision polygon with wall occlusion
    const visionPoly = this.generateVisionPolygon(position);
    
    if (visionPoly.length < 3) return;
    
    // Draw filled vision area
    this.graphics.moveTo(visionPoly[0].x, visionPoly[0].y);
    for (let i = 1; i < visionPoly.length; i++) {
      this.graphics.lineTo(visionPoly[i].x, visionPoly[i].y);
    }
    this.graphics.closePath();
    this.graphics.fill({ color, alpha });
    
    // Draw subtle outline
    this.graphics.moveTo(visionPoly[0].x, visionPoly[0].y);
    for (let i = 1; i < visionPoly.length; i++) {
      this.graphics.lineTo(visionPoly[i].x, visionPoly[i].y);
    }
    this.graphics.closePath();
    this.graphics.stroke({ width: 1, color, alpha: alpha * 0.5 });
  }
  
  /**
   * Update configuration
   */
  updateConfig(config: Partial<VisionBoxConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Set visibility
   */
  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }
  
  /**
   * Get container
   */
  getContainer(): PIXI.Container {
    return this.container;
  }
  
  /**
   * Clear rendering
   */
  clear(): void {
    this.graphics.clear();
  }
  
  /**
   * Destroy
   */
  destroy(): void {
    this.graphics.destroy();
    this.container.destroy();
  }
}
