/**
 * AI Agent Visual Renderer
 * Renders all AI agents with vision cones, action radii, and paths
 */

import * as PIXI from 'pixi.js';
import type { AIAgent } from '../engine/AIAgent.ts';
import { VisionConeRenderer } from './VisionConeRenderer.ts';
import { ActionRadiusRenderer } from './ActionRadiusRenderer.ts';
import { PathLineRenderer } from './PathLineRenderer.ts';

export interface AgentVisuals {
  sprite: PIXI.Graphics;
  visionCone: VisionConeRenderer;
  actionRadius: ActionRadiusRenderer;
  pathLine: PathLineRenderer;
  nameText: PIXI.Text;
}

export class AIAgentVisualRenderer {
  private container: PIXI.Container;
  private agentVisuals: Map<string, AgentVisuals>;
  private showVisionCones: boolean = true;
  private showActionRadius: boolean = true;
  private showPaths: boolean = true;
  
  constructor() {
    this.container = new PIXI.Container();
    this.agentVisuals = new Map();
  }
  
  /**
   * Initialize visuals for an agent
   */
  initializeAgent(agent: AIAgent): void {
    const agentId = agent.getId();
    
    if (this.agentVisuals.has(agentId)) {
      return; // Already initialized
    }
    
    // Create sprite (simple circle for now)
    const sprite = new PIXI.Graphics();
    sprite.beginFill(agent.getColor());
    sprite.drawCircle(0, 0, 15);
    sprite.endFill();
    
    // Add white outline
    sprite.lineStyle(2, 0xFFFFFF, 1);
    sprite.drawCircle(0, 0, 15);
    
    // Create vision cone
    const visionCone = new VisionConeRenderer({
      radius: agent.getVisionRadius(),
      color: agent.getColor(),
      alpha: 0.2,
      angle: Math.PI / 2 // 90 degrees
    });
    
    // Create action radius
    const actionRadius = new ActionRadiusRenderer({
      radius: agent.getActionRadius(),
      color: agent.getColor(),
      alpha: 0.4,
      lineWidth: 1,
      fillAlpha: 0.05
    });
    
    // Create path line
    const pathLine = new PathLineRenderer({
      color: agent.getColor(),
      alpha: 0.6,
      lineWidth: 2,
      dashLength: 8,
      gapLength: 4
    });
    
    // Create name text
    const nameText = new PIXI.Text(agentId, {
      fontFamily: 'Arial',
      fontSize: 10,
      fill: 0xFFFFFF,
      stroke: { color: 0x000000, width: 2 }
    });
    nameText.anchor.set(0.5, 0);
    nameText.y = 20;
    
    // Add to container (order matters for layering)
    this.container.addChild(visionCone.getContainer());
    this.container.addChild(pathLine.getContainer());
    this.container.addChild(actionRadius.getContainer());
    this.container.addChild(sprite);
    this.container.addChild(nameText);
    
    // Store visuals
    this.agentVisuals.set(agentId, {
      sprite,
      visionCone,
      actionRadius,
      pathLine,
      nameText
    });
  }
  
  /**
   * Update visuals for all agents
   */
  updateAgents(agents: AIAgent[]): void {
    for (const agent of agents) {
      this.updateAgent(agent);
    }
  }
  
  /**
   * Update visuals for a single agent
   */
  updateAgent(agent: AIAgent): void {
    const agentId = agent.getId();
    
    if (!this.agentVisuals.has(agentId)) {
      this.initializeAgent(agent);
    }
    
    const visuals = this.agentVisuals.get(agentId)!;
    const position = agent.getPosition();
    const facing = agent.getFacing();
    
    // Update sprite position
    visuals.sprite.x = position.x;
    visuals.sprite.y = position.y;
    
    // Update name text position
    visuals.nameText.x = position.x;
    visuals.nameText.y = position.y + 20;
    
    // Update vision cone
    if (this.showVisionCones) {
      visuals.visionCone.render(position, facing);
      visuals.visionCone.setVisible(true);
    } else {
      visuals.visionCone.setVisible(false);
    }
    
    // Update action radius
    if (this.showActionRadius) {
      visuals.actionRadius.render(position);
      visuals.actionRadius.setVisible(true);
    } else {
      visuals.actionRadius.setVisible(false);
    }
    
    // Update path
    if (this.showPaths) {
      const path = agent.getCurrentPath();
      if (path.length > 0) {
        visuals.pathLine.render(path);
        visuals.pathLine.setVisible(true);
      } else {
        visuals.pathLine.setVisible(false);
      }
    } else {
      visuals.pathLine.setVisible(false);
    }
  }
  
  /**
   * Toggle vision cones visibility
   */
  toggleVisionCones(show?: boolean): void {
    this.showVisionCones = show ?? !this.showVisionCones;
  }
  
  /**
   * Toggle action radius visibility
   */
  toggleActionRadius(show?: boolean): void {
    this.showActionRadius = show ?? !this.showActionRadius;
  }
  
  /**
   * Toggle paths visibility
   */
  togglePaths(show?: boolean): void {
    this.showPaths = show ?? !this.showPaths;
  }
  
  /**
   * Get container
   */
  getContainer(): PIXI.Container {
    return this.container;
  }
  
  /**
   * Clear all visuals
   */
  clear(): void {
    for (const visuals of this.agentVisuals.values()) {
      visuals.sprite.destroy();
      visuals.visionCone.destroy();
      visuals.actionRadius.destroy();
      visuals.pathLine.destroy();
      visuals.nameText.destroy();
    }
    this.agentVisuals.clear();
    this.container.removeChildren();
  }
  
  /**
   * Destroy
   */
  destroy(): void {
    this.clear();
    this.container.destroy();
  }
}
