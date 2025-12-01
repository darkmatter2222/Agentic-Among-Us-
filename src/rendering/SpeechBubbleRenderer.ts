/**
 * Speech Bubble Renderer
 * Renders animated speech bubbles (rectangular) and thought bubbles (cloud-shaped) above agents
 * Speech = what agents say out loud (rectangular with tail)
 * Thought = internal thoughts (cloud shape with small circles)
 */

import * as PIXI from 'pixi.js';

export type BubbleType = 'speech' | 'thought';

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
  bubbleType: BubbleType;
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
   * Show a speech bubble for an agent (rectangular with tail pointer)
   */
  showSpeech(agentId: string, message: string, position: { x: number; y: number }): void {
    this.showBubble(agentId, message, position, 'speech');
  }

  /**
   * Show a thought bubble for an agent (cloud-shaped with small circles)
   */
  showThought(agentId: string, message: string, position: { x: number; y: number }): void {
    this.showBubble(agentId, message, position, 'thought');
  }

  /**
   * Internal method to show a bubble of any type
   * Only one bubble (speech OR thought) can be shown per agent at a time
   */
  private showBubble(agentId: string, message: string, position: { x: number; y: number }, bubbleType: BubbleType): void {
    // Remove ANY existing bubble for this agent (speech or thought) - only one at a time
    this.removeAllBubbles(agentId);

    // Create bubble container
    const bubbleContainer = new PIXI.Container();
    // Same offset for both types now since only one shows at a time
    bubbleContainer.position.set(position.x, position.y + this.config.offsetY);
    bubbleContainer.alpha = 0;

    // Different text colors for thought vs speech
    const textColor = bubbleType === 'thought' ? 0x444444 : 0x222222;
    
    // Create text first to measure
    const text = new PIXI.Text({
      text: message,
      style: {
        fontFamily: 'Arial, sans-serif',
        fontSize: this.config.fontSize,
        fill: textColor,
        fontStyle: bubbleType === 'thought' ? 'italic' : 'normal',
        wordWrap: true,
        wordWrapWidth: this.config.maxWidth - this.config.padding * 2,
        align: 'center',
      },
    });
    text.anchor.set(0.5, 1);

    // Calculate bubble dimensions
    const bubbleWidth = Math.min(this.config.maxWidth, text.width + this.config.padding * 2);
    const bubbleHeight = text.height + this.config.padding * 2;
    const tailHeight = bubbleType === 'thought' ? 0 : 10; // Thoughts don't have a tail

    // Create background based on type
    const background = new PIXI.Graphics();
    if (bubbleType === 'thought') {
      this.drawThoughtBubble(background, bubbleWidth, bubbleHeight);
    } else {
      this.drawSpeechBubble(background, bubbleWidth, bubbleHeight, tailHeight);
    }

    // Position elements
    background.position.set(-bubbleWidth / 2, -bubbleHeight - tailHeight);
    text.position.set(0, -tailHeight - this.config.padding);

    bubbleContainer.addChild(background);
    bubbleContainer.addChild(text);
    this.container.addChild(bubbleContainer);

    // Calculate timing - thoughts display slightly longer
    const displayDuration = bubbleType === 'thought' ? this.config.displayDuration * 1.5 : this.config.displayDuration;
    const now = performance.now();
    const fadeInEnd = now + this.config.fadeInDuration;
    const displayEnd = fadeInEnd + displayDuration;
    const totalDuration = this.config.fadeInDuration + displayDuration + this.config.fadeOutDuration;

    // Store active bubble keyed by agentId (only one bubble per agent)
    this.activeBubbles.set(agentId, {
      container: bubbleContainer,
      background,
      text,
      startTime: now,
      phase: 'fadeIn',
      totalDuration,
      fadeInEnd,
      displayEnd,
      bubbleType,
    });
  }

  /**
   * Draw a rectangular speech bubble with tail pointer
   */
  private drawSpeechBubble(graphics: PIXI.Graphics, width: number, height: number, tailHeight: number): void {
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
   * Draw a thought bubble with rounded corners and small trailing circles
   */
  private drawThoughtBubble(graphics: PIXI.Graphics, width: number, height: number): void {
    const bgColor = 0xF8F8FF; // Slightly blue-ish white for thoughts
    const strokeColor = 0x888888; // Lighter gray stroke
    
    // Use a larger corner radius for the soft, rounded thought bubble look
    const cornerRadius = Math.min(width, height) * 0.35;
    
    // Draw the main rounded rectangle body
    graphics.roundRect(0, 0, width, height, cornerRadius);
    graphics.fill({ color: bgColor, alpha: 0.95 });
    graphics.stroke({ color: strokeColor, width: 2, alpha: 0.7 });
    
    // Draw trailing thought circles (3 small circles leading down to the head)
    const centerX = width / 2;
    const circleTrail = [
      { x: centerX - 15, y: height + 8, r: 8 },
      { x: centerX - 8, y: height + 20, r: 6 },
      { x: centerX - 2, y: height + 30, r: 4 },
    ];
    
    for (const c of circleTrail) {
      graphics.circle(c.x, c.y, c.r);
      graphics.fill({ color: bgColor, alpha: 0.95 });
      graphics.stroke({ color: strokeColor, width: 1.5, alpha: 0.7 });
    }
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
        // Same offset for all bubbles now (only one at a time)
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
  }  /**
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
   * Check if an agent currently has a bubble
   */
  hasBubble(agentId: string, _bubbleType?: BubbleType): boolean {
    return this.activeBubbles.has(agentId);
  }

  /**
   * Check if an agent has any bubble (speech or thought)
   */
  hasAnyBubble(agentId: string): boolean {
    return this.activeBubbles.has(agentId);
  }

  /**
   * Remove a specific agent's bubble
   */
  removeBubble(agentId: string, _bubbleType?: BubbleType): void {
    const bubble = this.activeBubbles.get(agentId);
    if (bubble) {
      this.container.removeChild(bubble.container);
      bubble.container.destroy({ children: true });
      this.activeBubbles.delete(agentId);
    }
  }

  /**
   * Remove all bubbles for an agent (same as removeBubble now since only one at a time)
   */
  removeAllBubbles(agentId: string): void {
    this.removeBubble(agentId);
  }

  /**
   * Clear ALL bubbles for ALL agents (for memory cleanup on match restart)
   */
  clearAllBubbles(): void {
    for (const [_, bubble] of this.activeBubbles) {
      this.container.removeChild(bubble.container);
      bubble.container.destroy({ children: true });
    }
    this.activeBubbles.clear();
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
