/**
 * Vision Cone Renderer
 * Renders 90-degree field of view with gradient alpha falloff
 */

import * as PIXI from 'pixi.js';
import type { Point } from '../data/poly3-map.ts';

export interface VisionConeConfig {
  radius: number;
  angle: number; // Field of view angle in radians (default: Math.PI / 2 for 90°)
  color: number;
  alpha: number;
  gradientSteps: number;
}

export class VisionConeRenderer {
  private container: PIXI.Container;
  private graphics: PIXI.Graphics;
  private config: VisionConeConfig;
  
  constructor(config?: Partial<VisionConeConfig>) {
    this.container = new PIXI.Container();
    this.graphics = new PIXI.Graphics();
    this.container.addChild(this.graphics);
    
    this.config = {
      radius: 150,
      angle: Math.PI / 2, // 90 degrees
      color: 0xFFFFFF,
      alpha: 0.01,
      gradientSteps: 20,
      ...config
    };
  }
  
  /**
   * Render vision cone at a position facing a direction
   */
  render(position: Point, facing: number): void {
    this.graphics.clear();
    
    const { radius, angle, color, alpha, gradientSteps } = this.config;
    
    // Calculate cone boundaries
    const halfAngle = angle / 2;
    const startAngle = facing - halfAngle;
    const endAngle = facing + halfAngle;
    
    // Draw gradient layers from outside to inside
    for (let i = 0; i < gradientSteps; i++) {
      const t = i / gradientSteps;
      const currentRadius = radius * (1 - t);
      const currentAlpha = alpha * (1 - t);
      
      this.graphics.beginFill(color, currentAlpha);
      this.graphics.moveTo(position.x, position.y);
      
      // Draw arc
      const segments = 30;
      for (let j = 0; j <= segments; j++) {
        const theta = startAngle + (endAngle - startAngle) * (j / segments);
        const x = position.x + Math.cos(theta) * currentRadius;
        const y = position.y + Math.sin(theta) * currentRadius;
        this.graphics.lineTo(x, y);
      }
      
      this.graphics.lineTo(position.x, position.y);
      this.graphics.endFill();
    }
  }
  
  /**
   * Update configuration
   */
  updateConfig(config: Partial<VisionConeConfig>): void {
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
