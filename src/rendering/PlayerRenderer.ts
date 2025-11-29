/**
 * Player Renderer - Renders player sprites with colors, states, and name labels
 * Implements Among Us style walking animation with bounce and waddle
 */

import * as PIXI from 'pixi.js';
import type { Player } from '@shared/types/game.types';
import { PlayerState, PlayerRole } from '@shared/types/game.types';

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
  private impostorIndicator: PIXI.Graphics; // Red outline for impostors (admin view only)

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
  // @ts-expect-error Reserved for future use
  private _idleBobTime: number = 0;
  // @ts-expect-error Reserved for future use
  private _idleBobSpeed: number = 2; // seconds per cycle
  // @ts-expect-error Reserved for future use
  private _idleBobAmount: number = 0; // NO idle bob - completely still when not walking

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

    // Create impostor indicator (ON TOP of body - red outline with glow)
    // Added last to bodyContainer so it renders on top and animates with body
    this.impostorIndicator = new PIXI.Graphics();
    this.bodyContainer.addChild(this.impostorIndicator);    // Create name label
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
    this.impostorIndicator.clear();

    const color = PlayerSprite.COLORS[this.player.color.toLowerCase()] || 0xFFFFFF;

    // Draw impostor indicator for admin view (only for living impostors)
    if (this.player.role === PlayerRole.IMPOSTOR && this.player.state === PlayerState.ALIVE) {
      this.drawImpostorIndicator();
    }

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
   * Draw impostor indicator - red outline with faint glow (admin view only)
   * This is purely informational for the administrator and has no gameplay impact
   * Draws OUTSIDE the black border: red border around the black border + faint outward glow
   */
  private drawImpostorIndicator(): void {
    const sizeMultiplier = PlayerSprite.SIZE_MULTIPLIER;
    const radius = 0.4 * this.scale * sizeMultiplier;
    
    // The body ellipse is radius * 0.85 wide, radius tall
    // The black border stroke is 1.5px wide, so outer edge is at ~radius * 0.85 + 0.75, radius + 0.75
    // We draw the red border OUTSIDE that
    
    const bodyRadiusX = radius * 0.85;
    const bodyRadiusY = radius;
    const blackBorderWidth = 1.5;
    
    // Outermost glow layer - soft diffuse glow
    this.impostorIndicator.ellipse(0, 0, bodyRadiusX + 8, bodyRadiusY + 8);
    this.impostorIndicator.stroke({ width: 6, color: 0xFF0000, alpha: 0.15 });
    
    // Middle glow layer
    this.impostorIndicator.ellipse(0, 0, bodyRadiusX + 5, bodyRadiusY + 5);
    this.impostorIndicator.stroke({ width: 4, color: 0xFF0000, alpha: 0.2 });
    
    // Inner glow layer - brighter
    this.impostorIndicator.ellipse(0, 0, bodyRadiusX + 3, bodyRadiusY + 3);
    this.impostorIndicator.stroke({ width: 2.5, color: 0xFF0000, alpha: 0.35 });
    
    // Main red border - solid red outline just outside the black border
    this.impostorIndicator.ellipse(0, 0, bodyRadiusX + blackBorderWidth + 1.5, bodyRadiusY + blackBorderWidth + 1.5);
    this.impostorIndicator.stroke({ width: 2, color: 0xFF0000, alpha: 0.85 });
  }/**
   * Draw dead body - Clean Among Us style: body cut in half with bone sticking out
   * No blood pool - just the clean body graphic
   */
  private drawDeadBody(color: number): void {
    const sizeMultiplier = PlayerSprite.SIZE_MULTIPLIER;
    const size = 0.5 * this.scale * sizeMultiplier;
    const darkerColor = this.darkenColor(color, 0.22);
    const darkestColor = this.darkenColor(color, 0.40);
    const visorColor = 0x030405; // Dark visor

    // NO BLOOD POOL - clear the shadow
    this.shadow.clear();

    // ===== UPPER HALF (LEFT SIDE) - Main body torso with backpack and visor =====
    // Main upper body shape (large bean/pill shape - the torso)
    this.graphics.ellipse(-size * 0.45, 0, size * 0.75, size * 0.55);
    this.graphics.fill(color);

    // Backpack (darker rounded hump on top of body)
    this.graphics.ellipse(-size * 0.85, -size * 0.05, size * 0.35, size * 0.42);
    this.graphics.fill(darkerColor);

    // Subtle shadow under backpack edge
    this.graphics.ellipse(-size * 0.65, size * 0.15, size * 0.15, size * 0.25);
    this.graphics.fill(darkestColor);

    // Visor (dark curved shape on front of head area)
    this.graphics.ellipse(-size * 0.25, -size * 0.25, size * 0.35, size * 0.2);
    this.graphics.fill(visorColor);
    
    // Visor highlight/reflection
    this.graphics.ellipse(-size * 0.15, -size * 0.32, size * 0.1, size * 0.05);
    this.graphics.fill({ color: 0xFFFFFF, alpha: 0.25 });

    // Cut/exposed interior on upper half
    this.graphics.ellipse(size * 0.2, size * 0.05, size * 0.15, size * 0.4);
    this.graphics.fill(darkestColor);

    // Upper half body outline
    this.graphics.ellipse(-size * 0.45, 0, size * 0.75, size * 0.55);
    this.graphics.stroke({ width: 1.5, color: 0x000000, alpha: 0.4 });

    // ===== LOWER HALF (RIGHT SIDE) - Bottom portion separated =====
    // Main lower body portion
    this.graphics.ellipse(size * 0.85, size * 0.1, size * 0.45, size * 0.35);
    this.graphics.fill(color);

    // Exposed interior on lower half
    this.graphics.ellipse(size * 0.5, size * 0.08, size * 0.12, size * 0.28);
    this.graphics.fill(darkestColor);

    // Lower half outline
    this.graphics.ellipse(size * 0.85, size * 0.1, size * 0.45, size * 0.35);
    this.graphics.stroke({ width: 1.5, color: 0x000000, alpha: 0.4 });

    // ===== BONE (Single white bone sticking out between halves) =====
    const boneWhite = 0xFCFBFC;
    const boneGray = 0xC3C3C3;
    const boneStartX = size * 0.15;
    const boneEndX = size * 0.55;
    const boneY = size * 0.05;
    const boneThickness = size * 0.1;

    // Draw bone shaft
    this.graphics.roundRect(
      boneStartX, 
      boneY - boneThickness / 2, 
      boneEndX - boneStartX, 
      boneThickness, 
      boneThickness * 0.3
    );
    this.graphics.fill(boneWhite);

    // Left bone knob (partially hidden in body)
    this.graphics.circle(boneStartX, boneY - boneThickness * 0.4, boneThickness * 0.55);
    this.graphics.fill(boneWhite);
    this.graphics.circle(boneStartX, boneY + boneThickness * 0.4, boneThickness * 0.55);
    this.graphics.fill(boneWhite);

    // Right bone knob (visible, sticking out)
    this.graphics.circle(boneEndX, boneY - boneThickness * 0.45, boneThickness * 0.6);
    this.graphics.fill(boneWhite);
    this.graphics.circle(boneEndX, boneY + boneThickness * 0.45, boneThickness * 0.6);
    this.graphics.fill(boneWhite);

    // Subtle shading on bone knobs
    this.graphics.circle(boneEndX + boneThickness * 0.15, boneY - boneThickness * 0.3, boneThickness * 0.25);
    this.graphics.fill(boneGray);
    this.graphics.circle(boneEndX + boneThickness * 0.15, boneY + boneThickness * 0.5, boneThickness * 0.25);
    this.graphics.fill(boneGray);

    // Bone outline for definition
    this.graphics.circle(boneEndX, boneY - boneThickness * 0.45, boneThickness * 0.6);
    this.graphics.stroke({ width: 1, color: 0xC0C0C0, alpha: 0.5 });
    this.graphics.circle(boneEndX, boneY + boneThickness * 0.45, boneThickness * 0.6);
    this.graphics.stroke({ width: 1, color: 0xC0C0C0, alpha: 0.5 });
  }/**
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
