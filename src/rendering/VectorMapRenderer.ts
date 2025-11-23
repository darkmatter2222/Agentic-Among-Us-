import * as PIXI from 'pixi.js';
import { SKELD_VECTOR_ROOMS, SKELD_VECTOR_HALLWAYS, SKELD_OUTLINE, SKELD_VECTOR_DOORS, CAMERA_POSITIONS } from '../data/skeld-map-vector';
import type { Position } from '../types/game.types';

export class VectorMapRenderer {
  private container: PIXI.Container;
  private roomGraphics: Map<string, PIXI.Graphics> = new Map();
  private hallwayGraphics: Map<string, PIXI.Graphics> = new Map();
  private ventSprites: Map<string, PIXI.Graphics> = new Map();
  private doorSprites: Map<string, PIXI.Graphics> = new Map();
  private cameraSprites: Map<string, PIXI.Graphics> = new Map();
  private scale: number = 20; // 1 unit = 20 pixels

  constructor() {
    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
  }

  getContainer(): PIXI.Container {
    return this.container;
  }

  renderMap(): void {
    // Clear existing
    this.container.removeChildren();
    
    // Add layers in order
    this.renderBackground();
    this.renderOutline();
    this.renderHallways();
    this.renderRooms();
    this.renderDoors();
    this.renderVents();
    this.renderCameras();
    this.renderEmergencyButton();
    this.renderTaskIndicators();
  }

  private renderBackground(): void {
    const bg = new PIXI.Graphics();
    bg.rect(-1000, -1000, 3000, 3000);
    bg.fill(0x0A0E27); // Dark space blue
    bg.zIndex = -100;
    this.container.addChild(bg);
  }

  private renderOutline(): void {
    const outline = new PIXI.Graphics();
    
    // Draw ship hull outline
    outline.setStrokeStyle({ width: 3, color: 0x2C3E50 });
    outline.rect(0, 0, 0, 0); // Dummy to initialize
    outline.fill({ color: 0x1A1A2E, alpha: 0.8 });
    
    // Draw the spaceship shape
    outline.moveTo(SKELD_OUTLINE[0].x * this.scale, SKELD_OUTLINE[0].y * this.scale);
    for (let i = 1; i < SKELD_OUTLINE.length; i++) {
      outline.lineTo(SKELD_OUTLINE[i].x * this.scale, SKELD_OUTLINE[i].y * this.scale);
    }
    outline.closePath();
    outline.fill({ color: 0x1A1A2E, alpha: 0.8 });
    outline.stroke({ width: 3, color: 0x2C3E50 });
    
    outline.zIndex = -50;
    this.container.addChild(outline);
  }

  private renderHallways(): void {
    SKELD_VECTOR_HALLWAYS.forEach(hallway => {
      const graphics = new PIXI.Graphics();
      
      // Special rendering for decontamination
      if (hallway.id === 'reactor_decontam') {
        // Green glow effect for decontamination
        graphics.setStrokeStyle({ width: 2, color: 0x00FF00, alpha: 0.3 });
      } else {
        graphics.setStrokeStyle({ width: 1, color: 0x3A3A3A, alpha: 0.5 });
      }
      
      // Draw hallway polygon
      graphics.moveTo(hallway.vertices[0].x * this.scale, hallway.vertices[0].y * this.scale);
      for (let i = 1; i < hallway.vertices.length; i++) {
        graphics.lineTo(hallway.vertices[i].x * this.scale, hallway.vertices[i].y * this.scale);
      }
      graphics.closePath();
      
      if (hallway.id === 'reactor_decontam') {
        graphics.fill({ color: 0x4A5A4A, alpha: 0.9 });
      } else {
        graphics.fill({ color: 0x4A4A4A });
      }
      
      graphics.zIndex = -10;
      this.hallwayGraphics.set(hallway.id, graphics);
      this.container.addChild(graphics);
    });
  }

  private renderRooms(): void {
    SKELD_VECTOR_ROOMS.forEach(room => {
      const graphics = new PIXI.Graphics();
      
      // Room shadow/depth effect
      const shadow = new PIXI.Graphics();
      shadow.moveTo((room.vertices[0].x + 0.2) * this.scale, (room.vertices[0].y + 0.2) * this.scale);
      for (let i = 1; i < room.vertices.length; i++) {
        shadow.lineTo((room.vertices[i].x + 0.2) * this.scale, (room.vertices[i].y + 0.2) * this.scale);
      }
      shadow.closePath();
      shadow.fill({ color: 0x000000, alpha: 0.3 });
      shadow.zIndex = 0;
      this.container.addChild(shadow);
      
      // Room fill with gradient effect
      const color = this.hexToNumber(room.color);
      graphics.setStrokeStyle({ width: 2, color: this.darkenColor(color, 0.7) });
      
      // Draw room polygon
      graphics.moveTo(room.vertices[0].x * this.scale, room.vertices[0].y * this.scale);
      for (let i = 1; i < room.vertices.length; i++) {
        graphics.lineTo(room.vertices[i].x * this.scale, room.vertices[i].y * this.scale);
      }
      graphics.closePath();
      graphics.fill({ color, alpha: 0.95 });
      graphics.stroke();
      
      // Add room label
      const label = new PIXI.Text({
        text: room.name,
        style: {
          fontFamily: 'Arial',
          fontSize: 14,
          fill: 0xFFFFFF,
          stroke: { color: 0x000000, width: 3 },
          align: 'center'
        }
      });
      label.anchor.set(0.5);
      label.position.set(room.center.x * this.scale, room.center.y * this.scale);
      label.alpha = 0.9;
      graphics.addChild(label);
      
      // Add inner lighting effect
      const innerGlow = new PIXI.Graphics();
      const shrinkFactor = 0.9;
      const centerX = room.center.x;
      const centerY = room.center.y;
      
      innerGlow.moveTo(
        centerX * this.scale + (room.vertices[0].x - centerX) * shrinkFactor * this.scale,
        centerY * this.scale + (room.vertices[0].y - centerY) * shrinkFactor * this.scale
      );
      for (let i = 1; i < room.vertices.length; i++) {
        innerGlow.lineTo(
          centerX * this.scale + (room.vertices[i].x - centerX) * shrinkFactor * this.scale,
          centerY * this.scale + (room.vertices[i].y - centerY) * shrinkFactor * this.scale
        );
      }
      innerGlow.closePath();
      innerGlow.fill({ color: 0xFFFFFF, alpha: 0.05 });
      graphics.addChild(innerGlow);
      
      graphics.zIndex = 10;
      this.roomGraphics.set(room.id, graphics);
      this.container.addChild(graphics);
    });
  }

  private renderDoors(): void {
    SKELD_VECTOR_DOORS.forEach(door => {
      const graphics = new PIXI.Graphics();
      
      // Door frame
      graphics.setStrokeStyle({ width: 2, color: 0x5A5A5A });
      
      if (door.orientation === 'horizontal') {
        graphics.rect(
          (door.position.x - 1) * this.scale,
          (door.position.y - 0.2) * this.scale,
          2 * this.scale,
          0.4 * this.scale
        );
      } else {
        graphics.rect(
          (door.position.x - 0.2) * this.scale,
          (door.position.y - 1) * this.scale,
          0.4 * this.scale,
          2 * this.scale
        );
      }
      graphics.fill({ color: 0x3A3A3A });
      graphics.stroke();
      
      // Door panels (closed state)
      graphics.setStrokeStyle({ width: 1, color: 0x7A7A7A });
      
      if (door.orientation === 'horizontal') {
        // Two panels that slide horizontally
        graphics.rect(
          (door.position.x - 0.8) * this.scale,
          (door.position.y - 0.15) * this.scale,
          0.8 * this.scale,
          0.3 * this.scale
        );
        graphics.fill({ color: 0x4A4A4A, alpha: 0.8 });
        graphics.stroke();
        
        graphics.rect(
          door.position.x * this.scale,
          (door.position.y - 0.15) * this.scale,
          0.8 * this.scale,
          0.3 * this.scale
        );
        graphics.fill({ color: 0x4A4A4A, alpha: 0.8 });
        graphics.stroke();
      } else {
        // Two panels that slide vertically
        graphics.rect(
          (door.position.x - 0.15) * this.scale,
          (door.position.y - 0.8) * this.scale,
          0.3 * this.scale,
          0.8 * this.scale
        );
        graphics.fill({ color: 0x4A4A4A, alpha: 0.8 });
        graphics.stroke();
        
        graphics.rect(
          (door.position.x - 0.15) * this.scale,
          door.position.y * this.scale,
          0.3 * this.scale,
          0.8 * this.scale
        );
        graphics.fill({ color: 0x4A4A4A, alpha: 0.8 });
        graphics.stroke();
      }
      
      graphics.zIndex = 15;
      this.doorSprites.set(door.id, graphics);
      this.container.addChild(graphics);
    });
  }

  private renderVents(): void {
    // Collect all vents from rooms
    const allVents: Array<{id: string, position: Position}> = [];
    SKELD_VECTOR_ROOMS.forEach(room => {
      if (room.vents) {
        room.vents.forEach(vent => {
          allVents.push({id: vent.id, position: vent.position});
        });
      }
    });

    allVents.forEach(vent => {
      const graphics = new PIXI.Graphics();
      
      // Vent shadow
      graphics.rect(
        (vent.position.x - 0.7) * this.scale,
        (vent.position.y - 0.7) * this.scale,
        1.4 * this.scale,
        1.4 * this.scale
      );
      graphics.fill({ color: 0x000000, alpha: 0.5 });
      
      // Vent grill
      graphics.setStrokeStyle({ width: 1, color: 0x2A2A2A });
      graphics.rect(
        (vent.position.x - 0.6) * this.scale,
        (vent.position.y - 0.6) * this.scale,
        1.2 * this.scale,
        1.2 * this.scale
      );
      graphics.fill({ color: 0x1A1A1A });
      graphics.stroke();
      
      // Grill lines
      graphics.setStrokeStyle({ width: 1, color: 0x0A0A0A });
      for (let i = 0; i < 4; i++) {
        const y = (vent.position.y - 0.4 + i * 0.3) * this.scale;
        graphics.moveTo((vent.position.x - 0.5) * this.scale, y);
        graphics.lineTo((vent.position.x + 0.5) * this.scale, y);
      }
      graphics.stroke();
      
      // Corner screws
      const screwPositions = [
        { x: -0.5, y: -0.5 },
        { x: 0.5, y: -0.5 },
        { x: -0.5, y: 0.5 },
        { x: 0.5, y: 0.5 }
      ];
      screwPositions.forEach(pos => {
        graphics.circle(
          (vent.position.x + pos.x) * this.scale,
          (vent.position.y + pos.y) * this.scale,
          2
        );
        graphics.fill({ color: 0x4A4A4A });
      });
      
      graphics.zIndex = 20;
      this.ventSprites.set(vent.id, graphics);
      this.container.addChild(graphics);
    });
  }

  private renderCameras(): void {
    CAMERA_POSITIONS.forEach(camera => {
      const graphics = new PIXI.Graphics();
      
      // Camera body
      graphics.setStrokeStyle({ width: 1, color: 0x3A3A3A });
      graphics.circle(
        camera.position.x * this.scale,
        camera.position.y * this.scale,
        0.3 * this.scale
      );
      graphics.fill({ color: 0x2A2A2A });
      graphics.stroke();
      
      // Camera lens (red when active)
      graphics.circle(
        camera.position.x * this.scale,
        camera.position.y * this.scale,
        0.15 * this.scale
      );
      graphics.fill({ color: 0xFF0000, alpha: 0.8 });
      
      // Camera vision cone (yellow)
      graphics.setStrokeStyle({ width: 1, color: 0xFFFF00, alpha: 0.2 });
      const coneAngle = 60; // degrees
      const coneLength = 5; // units
      const startAngle = camera.angle - coneAngle / 2;
      const endAngle = camera.angle + coneAngle / 2;
      
      graphics.moveTo(camera.position.x * this.scale, camera.position.y * this.scale);
      graphics.arc(
        camera.position.x * this.scale,
        camera.position.y * this.scale,
        coneLength * this.scale,
        (startAngle * Math.PI) / 180,
        (endAngle * Math.PI) / 180
      );
      graphics.closePath();
      graphics.fill({ color: 0xFFFF00, alpha: 0.1 });
      graphics.stroke();
      
      graphics.zIndex = 25;
      this.cameraSprites.set(camera.id, graphics);
      this.container.addChild(graphics);
    });
  }

  private renderEmergencyButton(): void {
    const cafeteria = SKELD_VECTOR_ROOMS.find(r => r.id === 'cafeteria');
    if (!cafeteria) return;
    
    const graphics = new PIXI.Graphics();
    
    // Button base
    graphics.setStrokeStyle({ width: 2, color: 0x8B0000 });
    graphics.circle(
      cafeteria.center.x * this.scale,
      cafeteria.center.y * this.scale,
      0.8 * this.scale
    );
    graphics.fill({ color: 0xFF0000, alpha: 0.9 });
    graphics.stroke();
    
    // Button highlight
    graphics.circle(
      (cafeteria.center.x - 0.2) * this.scale,
      (cafeteria.center.y - 0.2) * this.scale,
      0.4 * this.scale
    );
    graphics.fill({ color: 0xFFFFFF, alpha: 0.3 });
    
    // "!" symbol
    const exclamation = new PIXI.Text({
      text: '!',
      style: {
        fontFamily: 'Arial',
        fontSize: 16,
        fill: 0xFFFFFF,
        fontWeight: 'bold'
      }
    });
    exclamation.anchor.set(0.5);
    exclamation.position.set(
      cafeteria.center.x * this.scale,
      cafeteria.center.y * this.scale
    );
    graphics.addChild(exclamation);
    
    graphics.zIndex = 30;
    this.container.addChild(graphics);
  }

  private renderTaskIndicators(): void {
    // Visual task locations get special indicators
    const visualTasks = [
      { room: 'medbay', position: { x: 20, y: 11 } }, // Submit Scan
      { room: 'weapons', position: { x: 44, y: 11 } }, // Clear Asteroids
      { room: 'shields', position: { x: 51, y: 29 } }  // Prime Shields
    ];

    visualTasks.forEach(task => {
      const graphics = new PIXI.Graphics();
      
      // Green circle for visual tasks
      graphics.setStrokeStyle({ width: 2, color: 0x00FF00, alpha: 0.8 });
      graphics.circle(
        task.position.x * this.scale,
        task.position.y * this.scale,
        0.5 * this.scale
      );
      graphics.fill({ color: 0x00FF00, alpha: 0.2 });
      graphics.stroke();
      
      graphics.zIndex = 22;
      this.container.addChild(graphics);
    });
  }

  private hexToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
  }

  private darkenColor(color: number, factor: number): number {
    const r = ((color >> 16) & 255) * factor;
    const g = ((color >> 8) & 255) * factor;
    const b = (color & 255) * factor;
    return (r << 16) | (g << 8) | b;
  }

  update(_deltaTime: number): void {
    // Animate camera blinks
    this.cameraSprites.forEach((camera) => {
      const pulse = Math.sin(Date.now() * 0.002) * 0.5 + 0.5;
      camera.alpha = 0.7 + pulse * 0.3;
    });
  }
}
