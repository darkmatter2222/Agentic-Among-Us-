/**
 * Vision Box Renderer
 * Renders box-shaped field of view with wall occlusion (ray tracing)
 * Features gradient feathering on edges and strict walkable area clamping
 */

import * as PIXI from 'pixi.js';
import type { Point } from '@shared/data/poly3-map.ts';
import { POLY3_MAP_DATA, isPointWalkable } from '@shared/data/poly3-map.ts';

export interface VisionBoxConfig {
  size: number;       // Half-size of the vision box (box extends ±size from player)
  color: number;
  alpha: number;
  rayCount: number;   // Number of rays per side for wall occlusion
  featherSize: number; // Size of the gradient feather on edges
}

interface Edge {
  start: Point;
  end: Point;
}

export class VisionBoxRenderer {
  private container: PIXI.Container;
  private graphics: PIXI.Graphics;
  private gradientGraphics: PIXI.Graphics;
  private config: VisionBoxConfig;
  private walls: Edge[] = [];
  
  constructor(config?: Partial<VisionBoxConfig>) {
    this.container = new PIXI.Container();
    this.graphics = new PIXI.Graphics();
    this.gradientGraphics = new PIXI.Graphics();
    this.container.addChild(this.graphics);
    this.container.addChild(this.gradientGraphics);
    
    this.config = {
      size: 150,
      color: 0xFFFFFF,
      alpha: 0.12,
      rayCount: 120, // More rays for smoother edges
      featherSize: 30, // Gradient fade distance
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
   * Also ensures the endpoint is within walkable area
   */
  private castRay(originX: number, originY: number, dirX: number, dirY: number, maxDist: number): number {
    let closest = maxDist;
    
    // First, find wall intersections
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
    
    // Binary search to find the furthest walkable point along the ray
    // This ensures vision never leaks outside walkable areas
    let validDist = 0;
    let testDist = closest;
    const steps = 8; // Number of binary search steps
    
    for (let i = 0; i < steps; i++) {
      const midDist = (validDist + testDist) / 2;
      const testX = originX + dirX * midDist;
      const testY = originY + dirY * midDist;
      
      if (isPointWalkable(testX, testY, POLY3_MAP_DATA.walkableZones)) {
        validDist = midDist;
      } else {
        testDist = midDist;
      }
    }
    
    // Use the validated distance, but cap at wall intersection
    return Math.min(validDist, closest);
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
      const tX = dirX !== 0 ? size / Math.abs(dirX) : Infinity;
      const tY = dirY !== 0 ? size / Math.abs(dirY) : Infinity;
      const maxDist = Math.min(tX, tY);
      
      // Cast ray and get actual distance (blocked by wall or non-walkable area)
      const actualDist = this.castRay(position.x, position.y, dirX, dirY, maxDist);
      
      // Only add point if it's at a valid distance
      if (actualDist > 0.1) {
        points.push({
          x: position.x + dirX * actualDist,
          y: position.y + dirY * actualDist
        });
      }
    }
    
    return points;
  }
  
  /**
   * Render vision box at a position with gradient feathering
   */
  render(position: Point, _facing?: number): void {
    this.graphics.clear();
    this.gradientGraphics.clear();
    
    const { color, alpha, featherSize } = this.config;
    
    // Generate vision polygon with wall occlusion
    const visionPoly = this.generateVisionPolygon(position);
    
    if (visionPoly.length < 3) return;
    
    // Draw the main vision area (inner, full opacity)
    // Create an inner polygon by moving points toward center
    const innerPoly = this.createInnerPolygon(position, visionPoly, featherSize);
    
    if (innerPoly.length >= 3) {
      // Draw inner solid area
      this.graphics.moveTo(innerPoly[0].x, innerPoly[0].y);
      for (let i = 1; i < innerPoly.length; i++) {
        this.graphics.lineTo(innerPoly[i].x, innerPoly[i].y);
      }
      this.graphics.closePath();
      this.graphics.fill({ color, alpha });
    }
    
    // Draw gradient feather ring between inner and outer polygons
    this.renderFeatherGradient(position, innerPoly, visionPoly, color, alpha);
  }
  
  /**
   * Create an inner polygon by moving points toward the center
   */
  private createInnerPolygon(center: Point, outerPoly: Point[], inset: number): Point[] {
    const innerPoly: Point[] = [];
    
    for (const point of outerPoly) {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > inset) {
        const scale = (dist - inset) / dist;
        innerPoly.push({
          x: center.x + dx * scale,
          y: center.y + dy * scale
        });
      } else {
        // Point is too close to center, use center
        innerPoly.push({ x: center.x, y: center.y });
      }
    }
    
    return innerPoly;
  }
  
  /**
   * Render gradient feather between inner and outer polygons
   * Uses multiple rings with decreasing alpha
   */
  private renderFeatherGradient(
    _center: Point,
    innerPoly: Point[],
    outerPoly: Point[],
    color: number,
    maxAlpha: number
  ): void {
    const rings = 6; // Number of gradient rings
    
    for (let ring = 0; ring < rings; ring++) {
      const t = ring / rings;
      const ringAlpha = maxAlpha * (1 - t) * 0.7; // Fade out toward edge
      
      // Interpolate between inner and outer polygons
      const ringPoly: Point[] = [];
      const minLen = Math.min(innerPoly.length, outerPoly.length);
      
      for (let i = 0; i < minLen; i++) {
        ringPoly.push({
          x: innerPoly[i].x + (outerPoly[i].x - innerPoly[i].x) * t,
          y: innerPoly[i].y + (outerPoly[i].y - innerPoly[i].y) * t
        });
      }
      
      // Draw this ring
      if (ringPoly.length >= 3) {
        this.gradientGraphics.moveTo(ringPoly[0].x, ringPoly[0].y);
        for (let i = 1; i < ringPoly.length; i++) {
          this.gradientGraphics.lineTo(ringPoly[i].x, ringPoly[i].y);
        }
        this.gradientGraphics.closePath();
        this.gradientGraphics.fill({ color, alpha: ringAlpha });
      }
    }
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
    this.gradientGraphics.clear();
  }
  
  /**
   * Destroy
   */
  destroy(): void {
    this.graphics.destroy();
    this.gradientGraphics.destroy();
    this.container.destroy();
  }
}
