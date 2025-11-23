/**
 * Action Radius Renderer
 * Renders circular action/interaction radius around players
 */

import * as PIXI from 'pixi.js';
import type { Point } from '../data/poly3-map.ts';

export interface ActionRadiusConfig {
  radius: number;
  color: number;
  alpha: number;
  lineWidth: number;
  fillAlpha: number;
}

export class ActionRadiusRenderer {
  private container: PIXI.Container;
  private graphics: PIXI.Graphics;
  private config: ActionRadiusConfig;
  
  constructor(config?: Partial<ActionRadiusConfig>) {
    this.container = new PIXI.Container();
    this.graphics = new PIXI.Graphics();
    this.container.addChild(this.graphics);
    
    this.config = {
      radius: 50,
      color: 0xFFFFFF,
      alpha: 0.6,
      lineWidth: 2,
      fillAlpha: 0.1,
      ...config
    };
  }
  
  /**
   * Render action radius at a position
   */
  render(position: Point): void {
    this.graphics.clear();
    
    const { radius, color, alpha, lineWidth, fillAlpha } = this.config;
    
    // Draw filled circle
    this.graphics.beginFill(color, fillAlpha);
    this.graphics.drawCircle(position.x, position.y, radius);
    this.graphics.endFill();
    
    // Draw outline
    this.graphics.lineStyle(lineWidth, color, alpha);
    this.graphics.drawCircle(position.x, position.y, radius);
  }
  
  /**
   * Update configuration
   */
  updateConfig(config: Partial<ActionRadiusConfig>): void {
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
