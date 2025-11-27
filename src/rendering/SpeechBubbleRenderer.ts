/**
 * Speech Bubble Renderer
 * Renders animated speech bubbles above agents with fade in/out animations
 */

import * as PIXI from 'pixi.js';

export interface SpeechBubbleConfig {
  maxWidth?: number;
  padding?: number;
  fontSize?: number;
  fadeInDuration?: number;
  fadeOutDuration?: number;
  displayDuration?: number;
  offsetY?: number;
}

interface ActiveBubble {
  container: PIXI.Container;
  background: PIXI.Graphics;
  text: PIXI.Text;
  startTime: number;
  phase: 'fadeIn' | 'display' | 'fadeOut' | 'done';
  totalDuration: number;
  fadeInEnd: number;
  displayEnd: number;
}

const DEFAULT_CONFIG: Required<SpeechBubbleConfig> = {
  maxWidth: 200,
  padding: 12,
  fontSize: 14,
  fadeInDuration: 300,
  fadeOutDuration: 500,
  displayDuration: 4000,
  offsetY: -50,
};

export class SpeechBubbleRenderer {
  private container: PIXI.Container;
  private config: Required<SpeechBubbleConfig>;
  private activeBubbles: Map<string, ActiveBubble>;

  constructor(config: SpeechBubbleConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.container = new PIXI.Container();
    this.container.zIndex = 1000; // Always on top
    this.activeBubbles = new Map();
  }

  /**
   * Show a speech bubble for an agent
   */
  showSpeech(agentId: string, message: string, position: { x: number; y: number }): void {
    // Remove existing bubble for this agent if any
    const existing = this.activeBubbles.get(agentId);
    if (existing) {
      this.container.removeChild(existing.container);
      existing.container.destroy({ children: true });
    }

    // Create bubble container
    const bubbleContainer = new PIXI.Container();
    bubbleContainer.position.set(position.x, position.y + this.config.offsetY);
    bubbleContainer.alpha = 0;

    // Create text first to measure
    const text = new PIXI.Text({
      text: message,
      style: {
        fontFamily: 'Arial, sans-serif',
        fontSize: this.config.fontSize,
        fill: 0x222222,
        wordWrap: true,
        wordWrapWidth: this.config.maxWidth - this.config.padding * 2,
        align: 'center',
      },
    });
    text.anchor.set(0.5, 1);

    // Calculate bubble dimensions
    const bubbleWidth = Math.min(this.config.maxWidth, text.width + this.config.padding * 2);
    const bubbleHeight = text.height + this.config.padding * 2;
    const tailHeight = 10;

    // Create background with rounded corners and tail
    const background = new PIXI.Graphics();
    this.drawBubble(background, bubbleWidth, bubbleHeight, tailHeight);

    // Position elements
    background.position.set(-bubbleWidth / 2, -bubbleHeight - tailHeight);
    text.position.set(0, -tailHeight - this.config.padding);

    bubbleContainer.addChild(background);
    bubbleContainer.addChild(text);
    this.container.addChild(bubbleContainer);

    // Calculate timing
    const now = performance.now();
    const fadeInEnd = now + this.config.fadeInDuration;
    const displayEnd = fadeInEnd + this.config.displayDuration;
    const totalDuration = this.config.fadeInDuration + this.config.displayDuration + this.config.fadeOutDuration;

    // Store active bubble
    this.activeBubbles.set(agentId, {
      container: bubbleContainer,
      background,
      text,
      startTime: now,
      phase: 'fadeIn',
      totalDuration,
      fadeInEnd,
      displayEnd,
    });
  }

  /**
   * Draw a speech bubble shape
   */
  private drawBubble(graphics: PIXI.Graphics, width: number, height: number, tailHeight: number): void {
    const radius = 8;
    const tailWidth = 16;

    // Draw white background with shadow
    graphics.roundRect(0, 0, width, height, radius);
    graphics.fill({ color: 0xFFFFFF, alpha: 0.95 });
    graphics.stroke({ color: 0x333333, width: 2, alpha: 0.8 });

    // Draw tail (pointer)
    const tailX = width / 2;
    graphics.moveTo(tailX - tailWidth / 2, height);
    graphics.lineTo(tailX, height + tailHeight);
    graphics.lineTo(tailX + tailWidth / 2, height);
    graphics.closePath();
    graphics.fill({ color: 0xFFFFFF, alpha: 0.95 });
    
    // Tail border (left and right sides only)
    graphics.moveTo(tailX - tailWidth / 2, height);
    graphics.lineTo(tailX, height + tailHeight);
    graphics.stroke({ color: 0x333333, width: 2, alpha: 0.8 });
    
    graphics.moveTo(tailX, height + tailHeight);
    graphics.lineTo(tailX + tailWidth / 2, height);
    graphics.stroke({ color: 0x333333, width: 2, alpha: 0.8 });
  }

  /**
   * Update bubble positions and animations
   */
  update(_deltaTime: number, agentPositions: Map<string, { x: number; y: number }>): void {
    const now = performance.now();

    for (const [agentId, bubble] of this.activeBubbles) {
      const elapsed = now - bubble.startTime;

      // Update position to follow agent
      const pos = agentPositions.get(agentId);
      if (pos) {
        bubble.container.position.set(pos.x, pos.y + this.config.offsetY);
      }

      // Update animation phase and alpha
      if (now < bubble.fadeInEnd) {
        // Fade in
        bubble.phase = 'fadeIn';
        const progress = (now - bubble.startTime) / this.config.fadeInDuration;
        bubble.container.alpha = this.easeOutCubic(progress);
      } else if (now < bubble.displayEnd) {
        // Display (fully visible)
        bubble.phase = 'display';
        bubble.container.alpha = 1;
      } else if (elapsed < bubble.totalDuration) {
        // Fade out
        bubble.phase = 'fadeOut';
        const fadeOutStart = bubble.displayEnd;
        const fadeOutProgress = (now - fadeOutStart) / this.config.fadeOutDuration;
        bubble.container.alpha = 1 - this.easeInCubic(fadeOutProgress);
      } else {
        // Done - mark for removal
        bubble.phase = 'done';
      }
    }

    // Remove finished bubbles
    for (const [agentId, bubble] of this.activeBubbles) {
      if (bubble.phase === 'done') {
        this.container.removeChild(bubble.container);
        bubble.container.destroy({ children: true });
        this.activeBubbles.delete(agentId);
      }
    }
  }

  /**
   * Easing function for smooth fade in
   */
  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Easing function for smooth fade out
   */
  private easeInCubic(t: number): number {
    return t * t * t;
  }

  /**
   * Check if an agent currently has a speech bubble
   */
  hasBubble(agentId: string): boolean {
    return this.activeBubbles.has(agentId);
  }

  /**
   * Remove a specific agent's bubble
   */
  removeBubble(agentId: string): void {
    const bubble = this.activeBubbles.get(agentId);
    if (bubble) {
      this.container.removeChild(bubble.container);
      bubble.container.destroy({ children: true });
      this.activeBubbles.delete(agentId);
    }
  }

  getContainer(): PIXI.Container {
    return this.container;
  }

  destroy(): void {
    for (const [_, bubble] of this.activeBubbles) {
      bubble.container.destroy({ children: true });
    }
    this.activeBubbles.clear();
    this.container.destroy();
  }
}
