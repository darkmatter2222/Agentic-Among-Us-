/**
 * Player Renderer - Renders player sprites with colors, states, and name labels
 * Implements Among Us style walking animation with bounce and waddle
 */

import * as PIXI from 'pixi.js';
import type { Player } from '@shared/types/game.types';
import { PlayerState } from '@shared/types/game.types';

export class PlayerRenderer {
  private container: PIXI.Container;
  private playerSprites: Map<string, PlayerSprite>;
  private scale: number = 20;

  constructor(container: PIXI.Container) {
    this.container = container;
    this.playerSprites = new Map();
  }

  /**
   * Render all players
   */
  renderPlayers(players: Map<string, Player>): void {
    // Remove sprites for players that no longer exist
    this.playerSprites.forEach((sprite, playerId) => {
      if (!players.has(playerId)) {
        sprite.destroy();
        this.playerSprites.delete(playerId);
      }
    });

    // Update or create sprites for each player
    players.forEach((player, playerId) => {
      let sprite = this.playerSprites.get(playerId);
      
      if (!sprite) {
        sprite = new PlayerSprite(player, this.scale);
        this.playerSprites.set(playerId, sprite);
        this.container.addChild(sprite.container);
      }
      
      sprite.update(player);
    });
  }

  /**
   * Update animations
   */
  update(deltaTime: number): void {
    this.playerSprites.forEach(sprite => {
      sprite.animate(deltaTime);
    });
  }

  /**
   * Get player sprite by ID
   */
  getPlayerSprite(playerId: string): PlayerSprite | undefined {
    return this.playerSprites.get(playerId);
  }
}

/**
 * Individual player sprite with Among Us style animations
 * - Bouncing walk cycle (vertical bob)
 * - Waddle animation (feet alternating out/in)
 * - Characters are 20% larger than original
 */
class PlayerSprite {
  container: PIXI.Container;
  private bodyContainer: PIXI.Container; // Contains body + legs for coordinated animation
  private graphics: PIXI.Graphics;
  private leftLeg: PIXI.Graphics;
  private rightLeg: PIXI.Graphics;
  private nameLabel: PIXI.Text;
  private shadow: PIXI.Graphics;
  
  private player: Player;
  private scale: number;
  private prevPosition: { x: number; y: number } | null = null;
  
  // Size multiplier (now 44% larger than original - 1.2 * 1.2)
  private static readonly SIZE_MULTIPLIER = 1.44;
  
  // Animation state
  private walkTime: number = 0;
  private walkCycleSpeed: number = 10; // cycles per second (faster = more steps)
  private walkBounceAmount: number = 0.25; // MUCH more visible vertical bounce in units
  private legSpreadAmount: number = 0.18; // how far legs spread outward (increased)
  private isWalking: boolean = false;
  private walkSpeed: number = 0; // current movement speed for animation intensity
  
  // Idle animation (disabled - no bounce when standing still)
  private idleBobTime: number = 0;
  private idleBobSpeed: number = 2; // seconds per cycle
  private idleBobAmount: number = 0; // NO idle bob - completely still when not walking

  // Player color mapping
  private static readonly COLORS: Record<string, number> = {
    red: 0xC51111,
    blue: 0x132ED1,
    green: 0x117F2D,
    pink: 0xED54BA,
    orange: 0xEF7D0E,
    yellow: 0xF5F557,
    black: 0x3F474E,
    white: 0xD6E0F0
  };

  constructor(player: Player, scale: number) {
    this.player = player;
    this.scale = scale;
    this.container = new PIXI.Container();
    
    // Create shadow (below everything)
    this.shadow = new PIXI.Graphics();
    this.container.addChild(this.shadow);
    
    // Create body container for coordinated animation
    this.bodyContainer = new PIXI.Container();
    this.container.addChild(this.bodyContainer);
    
    // Create legs (behind body)
    this.leftLeg = new PIXI.Graphics();
    this.rightLeg = new PIXI.Graphics();
    this.bodyContainer.addChild(this.leftLeg);
    this.bodyContainer.addChild(this.rightLeg);
    
    // Create player body graphics
    this.graphics = new PIXI.Graphics();
    this.bodyContainer.addChild(this.graphics);
    
    // Create name label
    this.nameLabel = new PIXI.Text({
      text: player.name,
      style: {
        fontFamily: 'Arial, sans-serif',
        fontSize: 14,
        fontWeight: 'bold',
        fill: 0xFFFFFF,
        stroke: { color: 0x000000, width: 2 },
        align: 'center'
      }
    });
    this.nameLabel.anchor.set(0.5);
    this.container.addChild(this.nameLabel);
    
    this.draw();
  }

  /**
   * Update player data and redraw
   */
  update(player: Player): void {
    // Calculate movement speed to determine if walking
    if (this.prevPosition) {
      const dx = player.position.x - this.prevPosition.x;
      const dy = player.position.y - this.prevPosition.y;
      this.walkSpeed = Math.sqrt(dx * dx + dy * dy);
      // More generous threshold - if moved at all, consider walking
      this.isWalking = this.walkSpeed > 0.0001;
    }
    this.prevPosition = { x: player.position.x, y: player.position.y };
    
    this.player = player;
    
    // Update position
    const screenX = player.position.x * this.scale;
    const screenY = player.position.y * this.scale;
    this.container.position.set(screenX, screenY);
    
    // Redraw if state changed
    this.draw();
  }

  /**
   * Draw player sprite based on state
   */
  private draw(): void {
    this.graphics.clear();
    this.shadow.clear();
    this.leftLeg.clear();
    this.rightLeg.clear();
    
    const color = PlayerSprite.COLORS[this.player.color.toLowerCase()] || 0xFFFFFF;
    
    if (this.player.state === PlayerState.DEAD) {
      this.drawDeadBody(color);
      this.leftLeg.visible = false;
      this.rightLeg.visible = false;
    } else if (this.player.state === PlayerState.GHOST) {
      this.drawGhost(color);
      this.leftLeg.visible = false;
      this.rightLeg.visible = false;
    } else {
      this.drawAlive(color);
      this.leftLeg.visible = true;
      this.rightLeg.visible = true;
    }
    
    // Update name label position (adjusted for larger size)
    const sizeMultiplier = PlayerSprite.SIZE_MULTIPLIER;
    this.nameLabel.position.set(0, -1.7 * this.scale * sizeMultiplier);
    this.nameLabel.visible = this.player.state !== PlayerState.DEAD;
    
    // Update name label color background
    if (this.player.state === PlayerState.GHOST) {
      this.nameLabel.alpha = 0.5;
    } else {
      this.nameLabel.alpha = 1.0;
    }
  }

  /**
   * Draw living player (Among Us style bean shape with legs)
   * Now 20% larger with separate leg graphics for animation
   */
  private drawAlive(color: number): void {
    const sizeMultiplier = PlayerSprite.SIZE_MULTIPLIER;
    const radius = 0.4 * this.scale * sizeMultiplier; // 20% larger
    
    // Draw shadow (ellipse under character)
    this.shadow.ellipse(0, 0.25 * this.scale * sizeMultiplier, radius * 0.9, radius * 0.5);
    this.shadow.fill({ color: 0x000000, alpha: 0.3 });
    
    // Draw legs (small rounded rectangles at bottom)
    const legWidth = radius * 0.35;
    const legHeight = radius * 0.4;
    const legY = radius * 0.6; // Position at bottom of body
    const legColor = this.darkenColor(color, 0.15);
    
    // Left leg
    this.leftLeg.roundRect(-radius * 0.5 - legWidth * 0.3, legY, legWidth, legHeight, legWidth * 0.3);
    this.leftLeg.fill(legColor);
    this.leftLeg.stroke({ width: 1, color: 0x000000, alpha: 0.3 });
    
    // Right leg  
    this.rightLeg.roundRect(radius * 0.5 - legWidth * 0.7, legY, legWidth, legHeight, legWidth * 0.3);
    this.rightLeg.fill(legColor);
    this.rightLeg.stroke({ width: 1, color: 0x000000, alpha: 0.3 });
    
    // Main body (bean/capsule shape - taller oval)
    this.graphics.ellipse(0, 0, radius * 0.85, radius);
    this.graphics.fill(color);
    
    // Backpack (small bump on the back/side)
    const backpackWidth = radius * 0.35;
    const backpackHeight = radius * 0.6;
    this.graphics.roundRect(
      -radius * 0.85 - backpackWidth * 0.3, 
      -backpackHeight * 0.3, 
      backpackWidth, 
      backpackHeight,
      backpackWidth * 0.3
    );
    this.graphics.fill(this.darkenColor(color, 0.2));
    this.graphics.stroke({ width: 1, color: 0x000000, alpha: 0.3 });
    
    // Visor (lighter colored oval on the "face" area)
    const visorColor = this.lightenColor(color, 0.4);
    this.graphics.ellipse(radius * 0.15, -radius * 0.15, radius * 0.45, radius * 0.35);
    this.graphics.fill(visorColor);
    
    // Visor shine (small highlight)
    this.graphics.ellipse(radius * 0.3, -radius * 0.3, radius * 0.12, radius * 0.08);
    this.graphics.fill({ color: 0xFFFFFF, alpha: 0.6 });
    
    // Body outline
    this.graphics.ellipse(0, 0, radius * 0.85, radius);
    this.graphics.stroke({ width: 1.5, color: 0x000000, alpha: 0.4 });
  }

  /**
   * Draw dead body (cut in half with bone) - 20% larger
   */
  private drawDeadBody(color: number): void {
    const sizeMultiplier = PlayerSprite.SIZE_MULTIPLIER;
    const size = 0.5 * this.scale * sizeMultiplier;
    
    // Blood pool
    this.shadow.ellipse(0, 0, size * 1.5, size);
    this.shadow.fill({ color: color, alpha: 0.3 });
    
    // Top half
    this.graphics.rect(-size * 0.3, -size * 0.5, size * 0.6, size * 0.4);
    this.graphics.fill(color);
    
    // Bottom half
    this.graphics.rect(-size * 0.3, size * 0.2, size * 0.6, size * 0.4);
    this.graphics.fill(color);
    
    // Bone (white stick)
    this.graphics.rect(-size * 0.1, -size * 0.1, size * 0.2, size * 0.6);
    this.graphics.fill(0xFFFFFF);
    
    // Bone ends
    this.graphics.circle(0, -size * 0.1, size * 0.15);
    this.graphics.fill(0xFFFFFF);
    this.graphics.circle(0, size * 0.5, size * 0.15);
    this.graphics.fill(0xFFFFFF);
  }

  /**
   * Draw ghost (semi-transparent, floating) - 20% larger
   */
  private drawGhost(color: number): void {
    const sizeMultiplier = PlayerSprite.SIZE_MULTIPLIER;
    const radius = 0.4 * this.scale * sizeMultiplier;
    
    // Main body (semi-transparent)
    this.graphics.circle(0, 0, radius);
    this.graphics.fill({ color: color, alpha: 0.5 });
    
    // Visor
    const visorColor = this.lightenColor(color, 0.3);
    this.graphics.ellipse(0, -0.1 * this.scale, radius * 0.6, radius * 0.4);
    this.graphics.fill({ color: visorColor, alpha: 0.5 });
    
    // Wispy tail
    this.graphics.moveTo(0, radius);
    this.graphics.lineTo(-radius * 0.3, radius * 1.5);
    this.graphics.lineTo(0, radius * 1.3);
    this.graphics.lineTo(radius * 0.3, radius * 1.5);
    this.graphics.lineTo(0, radius);
    this.graphics.fill({ color: color, alpha: 0.3 });
  }

  /**
   * Animate player with Among Us style walk cycle
   * - Vertical bounce (bob up and down) - ONLY when walking
   * - Leg waddle (feet spread out and in alternately)
   * - Completely still when not moving
   */
  animate(deltaTime: number): void {
    if (this.player.state !== PlayerState.ALIVE) return;
    
    const sizeMultiplier = PlayerSprite.SIZE_MULTIPLIER;
    
    if (this.isWalking) {
      // Walking animation - bouncy waddle
      this.walkTime += deltaTime * this.walkCycleSpeed;
      
      // Vertical bounce - two bounces per walk cycle (like footsteps)
      // Use abs(sin) to create a bouncing effect that's always upward
      const bouncePhase = this.walkTime * Math.PI * 2;
      const bounceOffset = Math.abs(Math.sin(bouncePhase)) * this.walkBounceAmount * this.scale * sizeMultiplier;
      this.bodyContainer.position.y = -bounceOffset;
      
      // Leg waddle animation - legs spread out and come back in
      // Left and right legs are 180 degrees out of phase
      const leftLegPhase = Math.sin(bouncePhase);
      const rightLegPhase = Math.sin(bouncePhase + Math.PI);
      
      // Horizontal spread (out and in)
      const legSpread = this.legSpreadAmount * this.scale * sizeMultiplier;
      this.leftLeg.position.x = leftLegPhase * legSpread;
      this.rightLeg.position.x = rightLegPhase * legSpread;
      
      // Slight vertical movement on legs (lift when spreading)
      const legLift = 0.05 * this.scale * sizeMultiplier;
      this.leftLeg.position.y = -Math.abs(leftLegPhase) * legLift;
      this.rightLeg.position.y = -Math.abs(rightLegPhase) * legLift;
    } else {
      // NOT walking - completely still, no animation at all
      this.bodyContainer.position.y = 0;
      
      // Reset legs to neutral position when idle
      this.leftLeg.position.x = 0;
      this.rightLeg.position.x = 0;
      this.leftLeg.position.y = 0;
      this.rightLeg.position.y = 0;
      
      // Reset walk time so animation starts fresh when walking again
      this.walkTime = 0;
    }
  }

  /**
   * Lighten a color
   */
  private lightenColor(color: number, amount: number): number {
    const r = Math.min(255, ((color >> 16) & 0xFF) + amount * 255);
    const g = Math.min(255, ((color >> 8) & 0xFF) + amount * 255);
    const b = Math.min(255, (color & 0xFF) + amount * 255);
    return (r << 16) | (g << 8) | b;
  }

  /**
   * Darken a color
   */
  private darkenColor(color: number, amount: number): number {
    const r = Math.max(0, ((color >> 16) & 0xFF) - amount * 255);
    const g = Math.max(0, ((color >> 8) & 0xFF) - amount * 255);
    const b = Math.max(0, (color & 0xFF) - amount * 255);
    return (r << 16) | (g << 8) | b;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.container.destroy({ children: true });
  }
}
