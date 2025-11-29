/**
 * Hearing Indicator Renderer
 * Shows a brief visual indicator when an agent hears speech from another agent
 * Displays an ear icon or speech lines emanating toward the listener
 */

import * as PIXI from 'pixi.js';

interface ActiveIndicator {
  container: PIXI.Container;
  graphics: PIXI.Graphics;
  startTime: number;
  duration: number;
  speakerPosition: { x: number; y: number };
}

export interface HearingIndicatorConfig {
  /** Duration of the indicator animation in ms */
  duration?: number;
  /** Size of the indicator */
  size?: number;
  /** Color of the indicator */
  color?: number;
  /** Offset from agent position (above head) */
  offsetY?: number;
}

const DEFAULT_CONFIG: Required<HearingIndicatorConfig> = {
  duration: 1500,
  size: 12,
  color: 0x88CCFF, // Light blue for hearing
  offsetY: -40,
};

export class HearingIndicatorRenderer {
  private container: PIXI.Container;
  private config: Required<HearingIndicatorConfig>;
  private activeIndicators: Map<string, ActiveIndicator>;

  constructor(config: HearingIndicatorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.container = new PIXI.Container();
    this.container.zIndex = 950; // Below speech bubbles but above players
    this.activeIndicators = new Map();
  }

  getContainer(): PIXI.Container {
    return this.container;
  }

  /**
   * Show a hearing indicator for an agent
   * @param agentId The listener agent's ID
   * @param listenerPosition Position of the listening agent
   * @param speakerPosition Position of the speaking agent (for direction)
   */
  showHearing(
    agentId: string,
    listenerPosition: { x: number; y: number },
    speakerPosition: { x: number; y: number }
  ): void {
    // Remove any existing indicator for this agent
    this.removeIndicator(agentId);

    // Create container for the indicator
    const indicatorContainer = new PIXI.Container();
    indicatorContainer.x = listenerPosition.x;
    indicatorContainer.y = listenerPosition.y + this.config.offsetY;

    // Create the graphics
    const graphics = new PIXI.Graphics();
    this.drawHearingIndicator(graphics, speakerPosition, listenerPosition);

    indicatorContainer.addChild(graphics);
    this.container.addChild(indicatorContainer);

    // Store the active indicator
    this.activeIndicators.set(agentId, {
      container: indicatorContainer,
      graphics,
      startTime: Date.now(),
      duration: this.config.duration,
      speakerPosition,
    });
  }

  /**
   * Draw the hearing indicator (ear icon with sound waves)
   */
  private drawHearingIndicator(
    graphics: PIXI.Graphics,
    speakerPosition: { x: number; y: number },
    listenerPosition: { x: number; y: number }
  ): void {
    const size = this.config.size;
    const color = this.config.color;

    // Calculate direction from listener to speaker
    const dx = speakerPosition.x - listenerPosition.x;
    const dy = speakerPosition.y - listenerPosition.y;
    const angle = Math.atan2(dy, dx);

    // Draw a small ear icon
    graphics.beginFill(color, 0.9);
    
    // Simplified ear shape (curved arc)
    graphics.arc(0, 0, size * 0.6, -Math.PI * 0.7, Math.PI * 0.7, false);
    graphics.arc(0, 0, size * 0.3, Math.PI * 0.5, -Math.PI * 0.5, true);
    graphics.endFill();

    // Draw sound wave lines coming from speaker direction
    graphics.lineStyle(2, color, 0.7);
    
    // Rotate wave lines to face speaker
    const waveOffset = size * 1.2;
    for (let i = 0; i < 3; i++) {
      const waveRadius = size * 0.4 * (i + 1);
      const startAngle = angle - Math.PI * 0.3;
      const endAngle = angle + Math.PI * 0.3;
      
      const centerX = Math.cos(angle) * waveOffset;
      const centerY = Math.sin(angle) * waveOffset;
      
      graphics.arc(centerX, centerY, waveRadius, startAngle, endAngle, false);
      // Move to next arc without drawing
      graphics.moveTo(0, 0);
    }
  }

  /**
   * Update all active indicators (handle animations and cleanup)
   */
  update(_deltaTime: number, agentPositions: Map<string, { x: number; y: number }>): void {
    const now = Date.now();

    for (const [agentId, indicator] of this.activeIndicators) {
      const elapsed = now - indicator.startTime;
      const progress = elapsed / indicator.duration;

      if (progress >= 1) {
        // Animation complete, remove indicator
        this.removeIndicator(agentId);
        continue;
      }

      // Update position to follow agent
      const position = agentPositions.get(agentId);
      if (position) {
        indicator.container.x = position.x;
        indicator.container.y = position.y + this.config.offsetY;
      }

      // Fade out animation
      indicator.container.alpha = 1 - (progress * progress); // Ease out

      // Pulse effect
      const pulse = 1 + Math.sin(elapsed * 0.01) * 0.1;
      indicator.container.scale.set(pulse);
    }
  }

  /**
   * Remove indicator for a specific agent
   */
  removeIndicator(agentId: string): void {
    const indicator = this.activeIndicators.get(agentId);
    if (indicator) {
      indicator.container.destroy({ children: true });
      this.activeIndicators.delete(agentId);
    }
  }

  /**
   * Remove all indicators
   */
  clear(): void {
    for (const [agentId] of this.activeIndicators) {
      this.removeIndicator(agentId);
    }
  }

  /**
   * Destroy the renderer
   */
  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }
}
