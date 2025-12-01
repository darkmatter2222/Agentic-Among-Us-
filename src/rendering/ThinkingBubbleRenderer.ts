/**
 * Thinking Bubble Renderer
 * Renders animated thinking bubbles (ellipsis) above agents when they are making LLM calls
 */

import * as PIXI from 'pixi.js';

export interface ThinkingBubbleConfig {
  offsetY?: number;
  dotSize?: number;
  dotSpacing?: number;
  animationSpeed?: number;
}

interface ActiveThinkingBubble {
  container: PIXI.Container;
  dots: PIXI.Graphics[];
  startTime: number;
}

const DEFAULT_CONFIG: Required<ThinkingBubbleConfig> = {
  offsetY: -55,
  dotSize: 4,
  dotSpacing: 10,
  animationSpeed: 2, // cycles per second
};

export class ThinkingBubbleRenderer {
  private container: PIXI.Container;
  private config: Required<ThinkingBubbleConfig>;
  private activeBubbles: Map<string, ActiveThinkingBubble>;

  constructor(config: ThinkingBubbleConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.container = new PIXI.Container();
    this.container.zIndex = 999; // Just below speech bubbles
    this.activeBubbles = new Map();
  }

  /**
   * Show a thinking bubble for an agent
   */
  showThinking(agentId: string, position: { x: number; y: number }): void {
    // Skip if already has a thinking bubble
    if (this.activeBubbles.has(agentId)) {
      return;
    }

    const bubbleContainer = new PIXI.Container();
    bubbleContainer.position.set(position.x, position.y + this.config.offsetY);

    // Create bubble background
    const background = new PIXI.Graphics();
    const bubbleWidth = 50;
    const bubbleHeight = 28;
    const tailHeight = 8;
    const radius = 10;

    // Main bubble shape
    background.roundRect(-bubbleWidth / 2, -bubbleHeight - tailHeight, bubbleWidth, bubbleHeight, radius);
    background.fill({ color: 0x333333, alpha: 0.9 });
    background.stroke({ color: 0x555555, width: 2, alpha: 0.8 });

    // Small thinking circles leading to bubble
    background.circle(-8, -tailHeight / 2, 4);
    background.fill({ color: 0x333333, alpha: 0.9 });
    background.stroke({ color: 0x555555, width: 1.5, alpha: 0.8 });
    
    background.circle(-2, 2, 2.5);
    background.fill({ color: 0x333333, alpha: 0.9 });
    background.stroke({ color: 0x555555, width: 1, alpha: 0.8 });

    bubbleContainer.addChild(background);

    // Create the three dots
    const dots: PIXI.Graphics[] = [];
    const dotY = -bubbleHeight / 2 - tailHeight;
    
    for (let i = 0; i < 3; i++) {
      const dot = new PIXI.Graphics();
      const dotX = (i - 1) * this.config.dotSpacing;
      
      dot.circle(0, 0, this.config.dotSize);
      dot.fill({ color: 0xFFFFFF });
      dot.position.set(dotX, dotY);
      
      bubbleContainer.addChild(dot);
      dots.push(dot);
    }

    this.container.addChild(bubbleContainer);

    this.activeBubbles.set(agentId, {
      container: bubbleContainer,
      dots,
      startTime: performance.now(),
    });
  }

  /**
   * Hide thinking bubble for an agent
   */
  hideThinking(agentId: string): void {
    const bubble = this.activeBubbles.get(agentId);
    if (bubble) {
      this.container.removeChild(bubble.container);
      bubble.container.destroy({ children: true });
      this.activeBubbles.delete(agentId);
    }
  }

  /**
   * Check if an agent has a thinking bubble
   */
  hasThinking(agentId: string): boolean {
    return this.activeBubbles.has(agentId);
  }

  /**
   * Update bubble positions and animations
   */
  update(_deltaTime: number, agentPositions: Map<string, { x: number; y: number }>, thinkingAgents: Set<string>): void {
    const now = performance.now();

    // Add/remove thinking bubbles based on thinkingAgents set
    for (const agentId of thinkingAgents) {
      const pos = agentPositions.get(agentId);
      if (pos && !this.activeBubbles.has(agentId)) {
        this.showThinking(agentId, pos);
      }
    }

    // Remove bubbles for agents no longer thinking
    for (const agentId of this.activeBubbles.keys()) {
      if (!thinkingAgents.has(agentId)) {
        this.hideThinking(agentId);
      }
    }

    // Update positions and animations
    for (const [agentId, bubble] of this.activeBubbles) {
      // Update position to follow agent
      const pos = agentPositions.get(agentId);
      if (pos) {
        bubble.container.position.set(pos.x, pos.y + this.config.offsetY);
      }

      // Animate dots with bouncing effect
      const elapsed = (now - bubble.startTime) / 1000;
      const cyclePosition = elapsed * this.config.animationSpeed;

      for (let i = 0; i < bubble.dots.length; i++) {
        // Each dot is offset by 0.33 of the cycle
        const phase = (cyclePosition + i * 0.33) % 1;
        
        // Use a sine wave for smooth bouncing
        const bounce = Math.sin(phase * Math.PI);
        const baseY = -14 - 8; // Center of bubble
        
        bubble.dots[i].y = baseY - bounce * 6;
        bubble.dots[i].alpha = 0.5 + bounce * 0.5;
      }
    }
  }

  getContainer(): PIXI.Container {
    return this.container;
  }

  /**
   * Clear ALL bubbles for ALL agents (for memory cleanup on match restart)
   */
  clearAllBubbles(): void {
    for (const [agentId] of this.activeBubbles) {
      this.hideThinking(agentId);
    }
  }

  destroy(): void {
    for (const [_, bubble] of this.activeBubbles) {
      bubble.container.destroy({ children: true });
    }
    this.activeBubbles.clear();
    this.container.destroy();
  }
}
