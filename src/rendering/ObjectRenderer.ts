/**
 * Object Renderer - Tasks, vents, dead bodies, and other game objects
 */

import * as PIXI from 'pixi.js';
import type { Task, Vent, Player } from '../types/game.types';
import { PlayerState } from '../types/game.types';

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
   * Draw dead body (cut in half with bone)
   */
  private draw(): void {
    this.graphics.clear();
    
    const size = 0.5 * this.scale;
    const color = this.getPlayerColor();
    
    // Blood pool (fades over time)
    const bloodAlpha = Math.max(0.3, 0.5 - this.age * 0.05);
    this.graphics.ellipse(0, 0, size * 1.5, size);
    this.graphics.fill({ color: color, alpha: bloodAlpha });
    
    // Top half
    this.graphics.rect(-size * 0.3, -size * 0.5, size * 0.6, size * 0.4);
    this.graphics.fill(color);
    
    // Bottom half
    this.graphics.rect(-size * 0.3, size * 0.2, size * 0.6, size * 0.4);
    this.graphics.fill(color);
    
    // Bone (white stick)
    this.graphics.rect(-size * 0.1, -size * 0.1, size * 0.2, size * 0.6);
    this.graphics.fill(0xFFFFFF);
    
    // Bone ends (balls)
    this.graphics.circle(0, -size * 0.1, size * 0.15);
    this.graphics.fill(0xFFFFFF);
    this.graphics.circle(0, size * 0.5, size * 0.15);
    this.graphics.fill(0xFFFFFF);
    
    // Add some dark spots for decay
    if (this.age > 5) {
      const numSpots = Math.floor(this.age / 5);
      for (let i = 0; i < numSpots; i++) {
        const angle = (i / numSpots) * Math.PI * 2;
        const dist = size * 0.5;
        this.graphics.circle(Math.cos(angle) * dist, Math.sin(angle) * dist, 3);
        this.graphics.fill({ color: 0x000000, alpha: 0.3 });
      }
    }
  }

  /**
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
