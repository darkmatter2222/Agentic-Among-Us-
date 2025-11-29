/**
 * Object Renderer - Tasks, vents, dead bodies, and other game objects
 */

import * as PIXI from 'pixi.js';
import type { Task, Vent, Player } from '@shared/types/game.types';
import { PlayerState } from '@shared/types/game.types';

export class ObjectRenderer {
  private container: PIXI.Container;
  private taskSprites: Map<string, PIXI.Graphics>;
  private ventSprites: Map<string, VentSprite>;
  private bodySprites: Map<string, BodySprite>;
  private scale: number = 20;

  constructor(container: PIXI.Container) {
    this.container = container;
    this.taskSprites = new Map();
    this.ventSprites = new Map();
    this.bodySprites = new Map();
  }

  /**
   * Initialize vents from map data
   */
  initializeVents(vents: Vent[]): void {
    vents.forEach(vent => {
      const sprite = new VentSprite(vent, this.scale);
      this.ventSprites.set(vent.id, sprite);
      this.container.addChild(sprite.container);
    });
  }

  /**
   * Render task indicators for a player
   */
  renderPlayerTasks(tasks: Task[]): void {
    // Clear existing task sprites
    this.taskSprites.forEach(sprite => sprite.destroy());
    this.taskSprites.clear();
    
    // Create task indicator for each active task
    tasks.forEach(task => {
      if (!task.isCompleted) {
        const sprite = this.createTaskIndicator(task);
        this.taskSprites.set(task.id, sprite);
        this.container.addChild(sprite);
      }
    });
  }

  /**
   * Create task indicator sprite
   */
  private createTaskIndicator(task: Task): PIXI.Graphics {
    const graphics = new PIXI.Graphics();
    const x = task.position.x * this.scale;
    const y = task.position.y * this.scale;
    
    // Yellow exclamation mark icon
    // Outer glow
    graphics.circle(x, y, 12);
    graphics.fill({ color: 0xFFFF00, alpha: 0.3 });
    
    // Background circle
    graphics.circle(x, y, 8);
    graphics.fill({ color: 0xFFDD00 });
    
    // Exclamation mark
    graphics.rect(x - 1, y - 4, 2, 5);
    graphics.fill({ color: 0x000000 });
    graphics.circle(x, y + 3, 1);
    graphics.fill({ color: 0x000000 });
    
    // Pulse animation (handled in animate method)
    graphics.position.set(0, 0);
    
    return graphics;
  }

  /**
   * Update dead bodies
   */
  updateBodies(players: Map<string, Player>): void {
    // Remove bodies that no longer exist
    const deadPlayerIds = Array.from(players.values())
      .filter(p => p.state === PlayerState.DEAD)
      .map(p => p.id);
    
    this.bodySprites.forEach((sprite, playerId) => {
      if (!deadPlayerIds.includes(playerId)) {
        sprite.destroy();
        this.bodySprites.delete(playerId);
      }
    });
    
    // Add new bodies
    players.forEach((player, playerId) => {
      if (player.state === PlayerState.DEAD && !this.bodySprites.has(playerId)) {
        const sprite = new BodySprite(player, this.scale);
        this.bodySprites.set(playerId, sprite);
        this.container.addChild(sprite.container);
      }
    });
  }

  /**
   * Animate objects
   */
  animate(deltaTime: number): void {
    // Animate vents
    this.ventSprites.forEach(sprite => sprite.animate(deltaTime));
    
    // Pulse task indicators
    const pulseScale = 1 + Math.sin(Date.now() / 200) * 0.1;
    this.taskSprites.forEach(sprite => {
      sprite.scale.set(pulseScale);
    });
  }

  /**
   * Get vent sprite by ID
   */
  getVentSprite(ventId: string): VentSprite | undefined {
    return this.ventSprites.get(ventId);
  }
}

/**
 * Vent sprite with animation
 */
class VentSprite {
  container: PIXI.Container;
  private graphics: PIXI.Graphics;
  private scale: number;
  private animationTime: number = 0;

  constructor(vent: Vent, scale: number) {
    this.scale = scale;
    this.container = new PIXI.Container();
    
    this.graphics = new PIXI.Graphics();
    this.container.addChild(this.graphics);
    
    const x = vent.position.x * scale;
    const y = vent.position.y * scale;
    this.container.position.set(x, y);
    
    this.draw();
  }

  /**
   * Draw vent grill
   */
  private draw(): void {
    this.graphics.clear();
    
    const size = 0.6 * this.scale;
    
    // Shadow
    this.graphics.ellipse(0, size * 0.1, size * 0.8, size * 0.3);
    this.graphics.fill({ color: 0x000000, alpha: 0.4 });
    
    // Vent background (dark)
    this.graphics.rect(-size / 2, -size / 2, size, size);
    this.graphics.fill({ color: 0x1A1A1A });
    
    // Vent border
    this.graphics.rect(-size / 2, -size / 2, size, size);
    this.graphics.stroke({ width: 2, color: 0x404040 });
    
    // Grill slats (horizontal lines)
    const numSlats = 5;
    for (let i = 0; i < numSlats; i++) {
      const yOffset = -size / 2 + (size / (numSlats + 1)) * (i + 1);
      this.graphics.moveTo(-size / 2, yOffset);
      this.graphics.lineTo(size / 2, yOffset);
      this.graphics.stroke({ width: 1, color: 0x606060 });
    }
    
    // Corner screws
    const screwRadius = 2;
    const screwOffset = size / 2 - 4;
    [-screwOffset, screwOffset].forEach(x => {
      [-screwOffset, screwOffset].forEach(y => {
        this.graphics.circle(x, y, screwRadius);
        this.graphics.fill({ color: 0x808080 });
      });
    });
  }

  /**
   * Animate vent (subtle pulsing when active)
   */
  animate(deltaTime: number): void {
    this.animationTime += deltaTime;
    
    // Subtle breathing effect
    const breathScale = 1 + Math.sin(this.animationTime * 2) * 0.02;
    this.graphics.scale.set(breathScale);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/**
 * Dead body sprite
 */
class BodySprite {
  container: PIXI.Container;
  private graphics: PIXI.Graphics;
  private player: Player;
  private scale: number;
  private age: number = 0; // Time since death for decay effects

  constructor(player: Player, scale: number) {
    this.player = player;
    this.scale = scale;
    this.container = new PIXI.Container();
    
    this.graphics = new PIXI.Graphics();
    this.container.addChild(this.graphics);
    
    const x = player.position.x * scale;
    const y = player.position.y * scale;
    this.container.position.set(x, y);
    
    this.draw();
  }

  /**
   * Draw dead body - Clean Among Us style: body cut in half with bone sticking out
   * No blood pool - just the clean body graphic
   */
  private draw(): void {
    this.graphics.clear();

    const size = 0.5 * this.scale;
    const color = this.getPlayerColor();
    const darkerColor = this.darkenColor(color, 0.22);
    const darkestColor = this.darkenColor(color, 0.40);
    const visorColor = 0x030405; // Dark visor

    // ===== UPPER HALF (LEFT SIDE) - Main body torso with backpack and visor =====
    // Main upper body shape
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
  }

  /**
   * Darken a color by a factor (0-1)
   */
  private darkenColor(color: number, factor: number): number {
    const r = Math.floor(((color >> 16) & 0xFF) * (1 - factor));
    const g = Math.floor(((color >> 8) & 0xFF) * (1 - factor));
    const b = Math.floor((color & 0xFF) * (1 - factor));
    return (r << 16) | (g << 8) | b;
  }  /**
   * Get player color value
   */
  private getPlayerColor(): number {
    const colors: Record<string, number> = {
      red: 0xC51111,
      blue: 0x132ED1,
      green: 0x117F2D,
      pink: 0xED54BA,
      orange: 0xEF7D0E,
      yellow: 0xF5F557,
      black: 0x3F474E,
      white: 0xD6E0F0
    };
    return colors[this.player.color.toLowerCase()] || 0xFFFFFF;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
