/**
 * Door Renderer - Sliding doors with open/closed states and sabotage effects
 */

import * as PIXI from 'pixi.js';
import type { Door } from '@shared/types/game.types';

export class DoorRenderer {
  private container: PIXI.Container;
  private doorSprites: Map<string, DoorSprite>;
  private scale: number = 20;

  constructor(container: PIXI.Container) {
    this.container = container;
    this.doorSprites = new Map();
  }

  /**
   * Initialize all doors from map data
   */
  initializeDoors(doors: Door[]): void {
    doors.forEach(door => {
      const sprite = new DoorSprite(door, this.scale);
      this.doorSprites.set(door.id, sprite);
      this.container.addChild(sprite.container);
    });
  }

  /**
   * Update door states
   */
  updateDoors(doors: Door[]): void {
    doors.forEach(door => {
      const sprite = this.doorSprites.get(door.id);
      if (sprite) {
        sprite.update(door);
      }
    });
  }

  /**
   * Animate doors (sliding transitions)
   */
  animate(deltaTime: number): void {
    this.doorSprites.forEach(sprite => {
      sprite.animate(deltaTime);
    });
  }

  /**
   * Get door sprite by ID
   */
  getDoorSprite(doorId: string): DoorSprite | undefined {
    return this.doorSprites.get(doorId);
  }
}

/**
 * Individual door sprite with sliding animation
 */
class DoorSprite {
  container: PIXI.Container;
  private leftPanel: PIXI.Graphics;
  private rightPanel: PIXI.Graphics;
  private frame: PIXI.Graphics;
  private sabotageEffect: PIXI.Graphics;
  
  private door: Door;
  private scale: number;
  
  // Animation state
  private currentOpenAmount: number = 1.0; // 0 = closed, 1 = open
  private targetOpenAmount: number = 1.0;
  private animationSpeed: number = 3.0; // Units per second

  // Door dimensions
  private readonly DOOR_THICKNESS: number = 0.15;
  private readonly PANEL_COLOR: number = 0x4A4A4A;
  private readonly FRAME_COLOR: number = 0x2A2A2A;
  private readonly SABOTAGE_COLOR: number = 0xFF0000;

  constructor(door: Door, scale: number) {
    this.door = door;
    this.scale = scale;
    this.container = new PIXI.Container();
    
    // Set rotation based on orientation
    const angle = Math.atan2(door.end.y - door.start.y, door.end.x - door.start.x);
    this.container.rotation = angle;
    
    // Position at midpoint
    const midX = (door.start.x + door.end.x) / 2;
    const midY = (door.start.y + door.end.y) / 2;
    this.container.position.set(midX * scale, midY * scale);
    
    // Create door components
    this.frame = new PIXI.Graphics();
    this.container.addChild(this.frame);
    
    this.leftPanel = new PIXI.Graphics();
    this.container.addChild(this.leftPanel);
    
    this.rightPanel = new PIXI.Graphics();
    this.container.addChild(this.rightPanel);
    
    this.sabotageEffect = new PIXI.Graphics();
    this.container.addChild(this.sabotageEffect);
    
    // Initial state
    this.currentOpenAmount = door.isOpen ? 1.0 : 0.0;
    this.targetOpenAmount = this.currentOpenAmount;
    
    this.draw();
  }

  /**
   * Update door state
   */
  update(door: Door): void {
    this.door = door;
    this.targetOpenAmount = door.isOpen ? 1.0 : 0.0;
    
    // Redraw sabotage effect if needed
    this.drawSabotageEffect();
  }

  /**
   * Animate door sliding
   */
  animate(deltaTime: number): void {
    // Smoothly interpolate to target open amount
    if (Math.abs(this.currentOpenAmount - this.targetOpenAmount) > 0.01) {
      const direction = this.targetOpenAmount > this.currentOpenAmount ? 1 : -1;
      this.currentOpenAmount += direction * this.animationSpeed * deltaTime;
      
      // Clamp to target
      if (direction > 0) {
        this.currentOpenAmount = Math.min(this.currentOpenAmount, this.targetOpenAmount);
      } else {
        this.currentOpenAmount = Math.max(this.currentOpenAmount, this.targetOpenAmount);
      }
      
      this.draw();
    }
  }

  /**
   * Draw door panels and frame
   */
  private draw(): void {
    this.leftPanel.clear();
    this.rightPanel.clear();
    this.frame.clear();
    
    const doorLength = Math.sqrt(
      (this.door.end.x - this.door.start.x) ** 2 +
      (this.door.end.y - this.door.start.y) ** 2
    );
    const doorLengthPixels = doorLength * this.scale;
    const thicknessPixels = this.DOOR_THICKNESS * this.scale;
    
    // Draw frame
    this.frame.rect(
      -doorLengthPixels / 2 - thicknessPixels,
      -thicknessPixels - 2,
      doorLengthPixels + thicknessPixels * 2,
      thicknessPixels * 2 + 4
    );
    this.frame.fill(this.FRAME_COLOR);
    
    // Calculate panel positions based on open amount
    const panelWidth = doorLengthPixels / 2;
    const openOffset = panelWidth * this.currentOpenAmount;
    
    // Left panel (slides left)
    this.leftPanel.rect(
      -doorLengthPixels / 2 - openOffset,
      -thicknessPixels,
      panelWidth,
      thicknessPixels * 2
    );
    this.leftPanel.fill(this.PANEL_COLOR);
    
    // Left panel highlight
    this.leftPanel.rect(
      -doorLengthPixels / 2 - openOffset,
      -thicknessPixels,
      panelWidth,
      thicknessPixels / 2
    );
    this.leftPanel.fill({ color: 0x6A6A6A, alpha: 0.5 });
    
    // Right panel (slides right)
    this.rightPanel.rect(
      openOffset,
      -thicknessPixels,
      panelWidth,
      thicknessPixels * 2
    );
    this.rightPanel.fill(this.PANEL_COLOR);
    
    // Right panel highlight
    this.rightPanel.rect(
      openOffset,
      -thicknessPixels,
      panelWidth,
      thicknessPixels / 2
    );
    this.rightPanel.fill({ color: 0x6A6A6A, alpha: 0.5 });
  }

  /**
   * Draw sabotage effect (red pulsing outline)
   */
  private drawSabotageEffect(): void {
    this.sabotageEffect.clear();
    
    if (this.door.isSabotaged) {
      const doorLength = Math.sqrt(
        (this.door.end.x - this.door.start.x) ** 2 +
        (this.door.end.y - this.door.start.y) ** 2
      );
      const doorLengthPixels = doorLength * this.scale;
      const thicknessPixels = this.DOOR_THICKNESS * this.scale;
      
      // Red outline
      this.sabotageEffect.rect(
        -doorLengthPixels / 2 - thicknessPixels - 2,
        -thicknessPixels - 4,
        doorLengthPixels + thicknessPixels * 2 + 4,
        thicknessPixels * 2 + 8
      );
      this.sabotageEffect.stroke({ width: 2, color: this.SABOTAGE_COLOR, alpha: 0.8 });
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.container.destroy({ children: true });
  }
}
