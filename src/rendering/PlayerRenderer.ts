/**
 * Player Renderer - Renders player sprites with colors, states, and name labels
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
 * Individual player sprite with animations
 */
class PlayerSprite {
  container: PIXI.Container;
  private graphics: PIXI.Graphics;
  private nameLabel: PIXI.Text;
  private shadow: PIXI.Graphics;
  
  private player: Player;
  private scale: number;
  
  // Animation state
  private idleBobTime: number = 0;
  private idleBobSpeed: number = 2; // seconds per cycle
  private idleBobAmount: number = 0.1; // units

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
    
    // Create shadow
    this.shadow = new PIXI.Graphics();
    this.container.addChild(this.shadow);
    
    // Create player graphics
    this.graphics = new PIXI.Graphics();
    this.container.addChild(this.graphics);
    
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
    
    const color = PlayerSprite.COLORS[this.player.color.toLowerCase()] || 0xFFFFFF;
    
    if (this.player.state === PlayerState.DEAD) {
      this.drawDeadBody(color);
    } else if (this.player.state === PlayerState.GHOST) {
      this.drawGhost(color);
    } else {
      this.drawAlive(color);
    }
    
    // Update name label position
    this.nameLabel.position.set(0, -1.5 * this.scale);
    this.nameLabel.visible = this.player.state !== PlayerState.DEAD;
    
    // Update name label color background
    if (this.player.state === PlayerState.GHOST) {
      this.nameLabel.alpha = 0.5;
    } else {
      this.nameLabel.alpha = 1.0;
    }
  }

  /**
   * Draw living player (top-down astronaut)
   */
  private drawAlive(color: number): void {
    const radius = 0.4 * this.scale; // 0.8 unit diameter = 16 pixels
    
    // Draw shadow
    this.shadow.ellipse(0, 0.2 * this.scale, radius * 0.9, radius * 0.5);
    this.shadow.fill({ color: 0x000000, alpha: 0.3 });
    
    // Main body (circle)
    this.graphics.circle(0, 0, radius);
    this.graphics.fill(color);
    
    // Visor (lighter colored oval)
    const visorColor = this.lightenColor(color, 0.3);
    this.graphics.ellipse(0, -0.1 * this.scale, radius * 0.6, radius * 0.4);
    this.graphics.fill(visorColor);
    
    // Backpack (small rectangle on back)
    this.graphics.rect(-radius * 0.3, 0.1 * this.scale, radius * 0.6, radius * 0.4);
    this.graphics.fill(this.darkenColor(color, 0.2));
    
    // Outline
    this.graphics.circle(0, 0, radius);
    this.graphics.stroke({ width: 1, color: 0x000000, alpha: 0.5 });
  }

  /**
   * Draw dead body (cut in half with bone)
   */
  private drawDeadBody(color: number): void {
    const size = 0.5 * this.scale;
    
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
   * Draw ghost (semi-transparent, floating)
   */
  private drawGhost(color: number): void {
    const radius = 0.4 * this.scale;
    
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
   * Animate player (idle bob, walking, etc.)
   */
  animate(deltaTime: number): void {
    if (this.player.state !== PlayerState.ALIVE) return;
    
    // Idle bob animation
    this.idleBobTime += deltaTime;
    const bobOffset = Math.sin(this.idleBobTime * Math.PI * 2 / this.idleBobSpeed) * this.idleBobAmount * this.scale;
    this.graphics.position.y = bobOffset;
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
