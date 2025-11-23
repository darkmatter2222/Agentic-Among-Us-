/**
 * Map Renderer - Renders rooms, walls, hallways, and corridors
 */

import * as PIXI from 'pixi.js';
import type { Room, Wall } from '../types/game.types';

export class MapRenderer {
  private container: PIXI.Container;
  private scale: number = 20;
  
  // Room color mapping
  private readonly ROOM_COLORS: Record<string, number> = {
    cafeteria: 0xB0B0B0,
    weapons: 0x2B4C7E,
    shields: 0xD4C04A,
    navigation: 0x3A5F7D,
    o2: 0x6B9BD1,
    admin: 0xA89968,
    storage: 0xC17A3A,
    electrical: 0xE0C341,
    security: 0x7D7D7D,
    reactor: 0x5A9B8E,
    medbay: 0x4DBDBD,
    upper_engine: 0xD17A3D,
    lower_engine: 0xD17A3D,
    communications: 0x7BA3D0
  };

  constructor(container: PIXI.Container) {
    this.container = container;
  }

  /**
   * Render the entire map
   */
  renderMap(rooms: Room[]): void {
    this.container.removeChildren();
    
    // Render background (space)
    this.renderBackground();
    
    // Render hallways first (under rooms)
    this.renderHallways();
    
    // Render all rooms
    rooms.forEach(room => {
      this.renderRoom(room);
    });
    
    // Render room labels
    rooms.forEach(room => {
      this.renderRoomLabel(room);
    });
  }

  private renderBackground(): void {
    const bg = new PIXI.Graphics();
    bg.rect(0, 0, 60 * this.scale, 40 * this.scale);
    bg.fill(0x000814); // Very dark blue (space)
    this.container.addChild(bg);
  }

  /**
   * Render a single room
   */
  private renderRoom(room: Room): void {
    const graphics = new PIXI.Graphics();
    
    const x = room.position.x * this.scale;
    const y = room.position.y * this.scale;
    const width = room.width * this.scale;
    const height = room.height * this.scale;
    
    const roomColor = this.ROOM_COLORS[room.id] || 0x808080;
    
    // Draw room floor with subtle gradient
    graphics.rect(x, y, width, height);
    graphics.fill(roomColor);
    
    // Add subtle grid pattern overlay
    this.addGridPattern(graphics, x, y, width, height);
    
    // Draw walls
    this.renderWalls(graphics, room.walls);
    
    this.container.addChild(graphics);
  }

  /**
   * Add grid pattern to room floor
   */
  private addGridPattern(graphics: PIXI.Graphics, x: number, y: number, width: number, height: number): void {
    graphics.setStrokeStyle({
      width: 0.5,
      color: 0x000000,
      alpha: 0.05
    });
    
    // Vertical lines
    const gridSize = this.scale;
    for (let gx = x; gx <= x + width; gx += gridSize) {
      graphics.moveTo(gx, y);
      graphics.lineTo(gx, y + height);
    }
    
    // Horizontal lines
    for (let gy = y; gy <= y + height; gy += gridSize) {
      graphics.moveTo(x, gy);
      graphics.lineTo(x + width, gy);
    }
    
    graphics.stroke();
  }

  /**
   * Render walls for a room
   */
  private renderWalls(graphics: PIXI.Graphics, walls: Wall[]): void {
    const wallThickness = 0.5 * this.scale; // 10 pixels
    const wallColor = 0x3D3D3D;
    
    walls.forEach(wall => {
      const startX = wall.start.x * this.scale;
      const startY = wall.start.y * this.scale;
      const endX = wall.end.x * this.scale;
      const endY = wall.end.y * this.scale;
      
      graphics.setStrokeStyle({
        width: wallThickness,
        color: wallColor,
        cap: 'round'
      });
      
      graphics.moveTo(startX, startY);
      graphics.lineTo(endX, endY);
      graphics.stroke();
      
      // Add inner shadow for depth
      graphics.setStrokeStyle({
        width: wallThickness * 0.3,
        color: 0x000000,
        alpha: 0.3,
        cap: 'round'
      });
      
      graphics.moveTo(startX, startY);
      graphics.lineTo(endX, endY);
      graphics.stroke();
    });
  }

  /**
   * Render hallways connecting rooms
   */
  private renderHallways(): void {
    const graphics = new PIXI.Graphics();
    const hallwayColor = 0x505050; // Slightly darker than most rooms
    
    // Upper Corridor (Cafeteria → Admin → Navigation → O2)
    this.drawHallway(graphics, 28, 10, 44, 13, hallwayColor);
    
    // Cafeteria to Admin connector
    this.drawHallway(graphics, 20, 15, 28, 20, hallwayColor);
    
    // Storage to Cafeteria
    this.drawHallway(graphics, 12, 19, 20, 22, hallwayColor);
    
    // Electrical connector
    this.drawHallway(graphics, 17, 13, 20, 19, hallwayColor);
    
    // Upper Engine to Reactor (with decontamination)
    this.drawDecontaminationZone(graphics, 8, 8, 10, 11);
    
    // Reactor to Lower Engine (with decontamination)
    this.drawDecontaminationZone(graphics, 8, 14, 10, 17);
    
    // Navigation to O2
    this.drawHallway(graphics, 32, 9, 38, 16, hallwayColor);
    
    // Weapons to hallway
    this.drawHallway(graphics, 24, 2, 28, 7, hallwayColor);
    
    // Communications to hallway
    this.drawHallway(graphics, 25, 20, 28, 25, hallwayColor);
    
    // MedBay to hallway
    this.drawHallway(graphics, 18, 7, 24, 12, hallwayColor);
    
    // Security to hallway
    this.drawHallway(graphics, 15, 8, 18, 13, hallwayColor);
    
    this.container.addChild(graphics);
  }

  /**
   * Draw a hallway rectangle
   */
  private drawHallway(
    graphics: PIXI.Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: number
  ): void {
    const x = Math.min(x1, x2) * this.scale;
    const y = Math.min(y1, y2) * this.scale;
    const width = Math.abs(x2 - x1) * this.scale;
    const height = Math.abs(y2 - y1) * this.scale;
    
    graphics.rect(x, y, width, height);
    graphics.fill(color);
  }

  /**
   * Draw decontamination zone (green tinted)
   */
  private drawDecontaminationZone(
    graphics: PIXI.Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): void {
    const x = Math.min(x1, x2) * this.scale;
    const y = Math.min(y1, y2) * this.scale;
    const width = Math.abs(x2 - x1) * this.scale;
    const height = Math.abs(y2 - y1) * this.scale;
    
    // Base hallway
    graphics.rect(x, y, width, height);
    graphics.fill(0x505050);
    
    // Green overlay for decon
    graphics.rect(x, y, width, height);
    graphics.fill({ color: 0x00FF00, alpha: 0.1 });
    
    // Scan lines (will be animated separately)
    for (let i = 0; i < 3; i++) {
      const lineY = y + (height / 4) * (i + 1);
      graphics.setStrokeStyle({
        width: 2,
        color: 0x00FF00,
        alpha: 0.3
      });
      graphics.moveTo(x, lineY);
      graphics.lineTo(x + width, lineY);
      graphics.stroke();
    }
  }

  /**
   * Render room name label
   */
  private renderRoomLabel(room: Room): void {
    const centerX = (room.position.x + room.width / 2) * this.scale;
    const centerY = (room.position.y + room.height / 2) * this.scale;
    
    const label = new PIXI.Text({
      text: room.name,
      style: {
        fontFamily: 'Arial, sans-serif',
        fontSize: 18,
        fontWeight: 'bold',
        fill: 0xFFFFFF,
        stroke: { color: 0x000000, width: 3 },
        align: 'center'
      }
    });
    
    label.anchor.set(0.5);
    label.position.set(centerX, centerY);
    label.alpha = 0.6; // Subtle
    
    this.container.addChild(label);
  }

  /**
   * Update map (for animated elements like decon scan lines)
   */
  update(_deltaTime: number): void {
    // Animation updates go here
    // For now, static rendering
  }
}
