/**
 * Path Line Renderer
 * Renders dotted/dashed lines showing player movement paths
 */

import * as PIXI from 'pixi.js';
import type { Point } from '@shared/data/poly3-map.ts';

export interface PathLineConfig {
  color: number;
  alpha: number;
  lineWidth: number;
  dashLength: number;
  gapLength: number;
}

export class PathLineRenderer {
  private container: PIXI.Container;
  private graphics: PIXI.Graphics;
  private config: PathLineConfig;
  
  constructor(config?: Partial<PathLineConfig>) {
    this.container = new PIXI.Container();
    this.graphics = new PIXI.Graphics();
    this.container.addChild(this.graphics);
    
    this.config = {
      color: 0xFFFFFF,
      alpha: 0.5,
      lineWidth: 2,
      dashLength: 10,
      gapLength: 5,
      ...config
    };
  }
  
  /**
   * Render a dotted path line through multiple points
   */
  render(points: Point[]): void {
    this.graphics.clear();
    
    if (points.length < 2) {
      return;
    }
    
    const { color, alpha, lineWidth } = this.config;
    
    this.graphics.lineStyle(lineWidth, color, alpha);
    
    // Draw dashed line through all points
    for (let i = 0; i < points.length - 1; i++) {
      this.drawDashedLine(points[i], points[i + 1]);
    }
  }
  
  /**
   * Draw a dashed line between two points
   */
  private drawDashedLine(start: Point, end: Point): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const totalLength = Math.sqrt(dx * dx + dy * dy);
    
    if (totalLength === 0) return;
    
    const { dashLength, gapLength } = this.config;
    
    const dirX = dx / totalLength;
    const dirY = dy / totalLength;
    
    let currentDistance = 0;
    let drawing = true;
    
    while (currentDistance < totalLength) {
      const segmentStart = {
        x: start.x + dirX * currentDistance,
        y: start.y + dirY * currentDistance
      };
      
      const nextDistance = Math.min(
        currentDistance + (drawing ? dashLength : gapLength),
        totalLength
      );
      
      const segmentEnd = {
        x: start.x + dirX * nextDistance,
        y: start.y + dirY * nextDistance
      };
      
      if (drawing) {
        this.graphics.moveTo(segmentStart.x, segmentStart.y);
        this.graphics.lineTo(segmentEnd.x, segmentEnd.y);
      }
      
      currentDistance = nextDistance;
      drawing = !drawing;
    }
  }
  
  /**
   * Render waypoints as circles along the path
   */
  renderWaypoints(points: Point[], waypointRadius: number = 3): void {
    const { color, alpha } = this.config;
    
    this.graphics.beginFill(color, alpha);
    for (const point of points) {
      this.graphics.drawCircle(point.x, point.y, waypointRadius);
    }
    this.graphics.endFill();
  }
  
  /**
   * Render both path and waypoints
   */
  renderComplete(points: Point[], showWaypoints: boolean = false): void {
    this.render(points);
    if (showWaypoints && points.length > 0) {
      this.renderWaypoints(points);
    }
  }
  
  /**
   * Update configuration
   */
  updateConfig(config: Partial<PathLineConfig>): void {
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
