import * as PIXI from 'pixi.js';
import { 
  POLY3_MAP_DATA, 
  calculateCentroid, 
  type Point, 
  type WalkableZone, 
  type LabeledZone 
} from '../data/poly3-map';

/**
 * Renderer for the poly 3.json map format
 * Renders walkable zones, labeled zones (room names), vents, and tasks
 * Based on JSON_FORMAT_SPECIFICATION.md
 */
export class Poly3MapRenderer {
  private container: PIXI.Container;
  private walkableGraphics: PIXI.Graphics[] = [];
  private labelGraphics: PIXI.Text[] = [];
  private ventSprites: Map<string, PIXI.Graphics> = new Map();
  private taskSprites: Map<string, PIXI.Graphics> = new Map();
  private scale: number = 1; // Direct pixel mapping from JSON

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
    this.walkableGraphics = [];
    this.labelGraphics = [];
    this.ventSprites.clear();
    this.taskSprites.clear();
    
    // Add layers in order
    this.renderBackground();
    this.renderWalkableZones();
    this.renderLabeledZoneColors(); // Render zone colors first
    this.renderLabeledZoneText(); // Then render text labels
    this.renderVents();
    this.renderTasks();
  }

  private renderBackground(): void {
    const bg = new PIXI.Graphics();
    bg.rect(-500, -500, 4000, 3000);
    bg.fill(0x0A0E27); // Dark space blue
    bg.zIndex = -100;
    this.container.addChild(bg);
  }

  /**
   * Render walkable zones as filled polygons with holes (obstacles)
   * No zone boundaries are shown - just the walkable areas
   */
  private renderWalkableZones(): void {
    POLY3_MAP_DATA.walkableZones.forEach((zone: WalkableZone) => {
      const graphics = new PIXI.Graphics();
      
      // Draw the main walkable zone polygon - gray for corridors/hallways
      this.drawPolygon(graphics, zone.vertices, 0x4A4A4A, 1.0, false);
      
      // Draw holes (obstacles) - these are non-walkable areas
      // We'll render them as darker areas to show walls/obstacles
      zone.holes.forEach((hole: Point[]) => {
        this.drawPolygon(graphics, hole, 0x2A2A2A, 1.0, false);
      });
      
      graphics.zIndex = -10;
      this.walkableGraphics.push(graphics);
      this.container.addChild(graphics);
    });
  }

  /**
   * Render labeled zone colors - only in walkable areas
   */
  private renderLabeledZoneColors(): void {
    POLY3_MAP_DATA.labeledZones.forEach((zone: LabeledZone) => {
      const zoneGraphics = new PIXI.Graphics();
      
      // Create a mask from the walkable zones
      const walkableMask = new PIXI.Graphics();
      POLY3_MAP_DATA.walkableZones.forEach((walkableZone) => {
        // Draw walkable zone
        walkableMask.moveTo(walkableZone.vertices[0].x * this.scale, walkableZone.vertices[0].y * this.scale);
        for (let i = 1; i < walkableZone.vertices.length; i++) {
          walkableMask.lineTo(walkableZone.vertices[i].x * this.scale, walkableZone.vertices[i].y * this.scale);
        }
        walkableMask.closePath();
        walkableMask.fill({ color: 0xFFFFFF });
        
        // Cut out holes
        walkableZone.holes.forEach((hole: Point[]) => {
          walkableMask.moveTo(hole[0].x * this.scale, hole[0].y * this.scale);
          for (let i = 1; i < hole.length; i++) {
            walkableMask.lineTo(hole[i].x * this.scale, hole[i].y * this.scale);
          }
          walkableMask.closePath();
          walkableMask.fill({ color: 0x000000 });
          walkableMask.cut();
        });
      });
      
      // Draw the labeled zone with teal color
      zoneGraphics.moveTo(zone.vertices[0].x * this.scale, zone.vertices[0].y * this.scale);
      for (let i = 1; i < zone.vertices.length; i++) {
        zoneGraphics.lineTo(zone.vertices[i].x * this.scale, zone.vertices[i].y * this.scale);
      }
      zoneGraphics.closePath();
      zoneGraphics.fill({ color: 0x1A3A3A, alpha: 1.0 });
      
      // Apply the walkable mask
      zoneGraphics.mask = walkableMask;
      this.container.addChild(walkableMask);
      
      zoneGraphics.zIndex = -5;
      this.container.addChild(zoneGraphics);
    });
  }

  /**
   * Render labeled zone text labels at their centers
   */
  private renderLabeledZoneText(): void {
    POLY3_MAP_DATA.labeledZones.forEach((zone: LabeledZone) => {
      // Calculate center point of the zone
      const center = calculateCentroid(zone.vertices);
      
      // Create text label for the room name
      const label = new PIXI.Text({
        text: zone.name,
        style: {
          fontFamily: 'Arial',
          fontSize: 24,
          fill: 0xFFFFFF,
          stroke: { color: 0x000000, width: 4 },
          align: 'center',
          fontWeight: 'bold'
        }
      });
      
      label.anchor.set(0.5);
      label.position.set(center.x * this.scale, center.y * this.scale);
      label.alpha = 0.85;
      label.zIndex = 50;
      
      this.labelGraphics.push(label);
      this.container.addChild(label);
    });
  }

  /**
   * Render vents at their specified positions
   */
  private renderVents(): void {
    POLY3_MAP_DATA.vents.forEach(vent => {
      const graphics = new PIXI.Graphics();
      const pos = vent.position;
      const size = 20; // Vent size in pixels
      
      // Vent shadow
      graphics.rect(
        pos.x * this.scale - size / 2 + 2,
        pos.y * this.scale - size / 2 + 2,
        size,
        size
      );
      graphics.fill({ color: 0x000000, alpha: 0.5 });
      
      // Vent grill
      graphics.setStrokeStyle({ width: 2, color: 0x2A2A2A });
      graphics.rect(
        pos.x * this.scale - size / 2,
        pos.y * this.scale - size / 2,
        size,
        size
      );
      graphics.fill({ color: 0x1A1A1A });
      graphics.stroke();
      
      // Grill lines (horizontal)
      graphics.setStrokeStyle({ width: 1, color: 0x0A0A0A });
      for (let i = 0; i < 5; i++) {
        const y = pos.y * this.scale - size / 2 + (i + 1) * (size / 6);
        graphics.moveTo(pos.x * this.scale - size / 2 + 2, y);
        graphics.lineTo(pos.x * this.scale + size / 2 - 2, y);
      }
      graphics.stroke();
      
      // Corner screws
      const screwSize = 2;
      const screwOffset = size / 2 - 3;
      const screwPositions = [
        { x: -screwOffset, y: -screwOffset },
        { x: screwOffset, y: -screwOffset },
        { x: -screwOffset, y: screwOffset },
        { x: screwOffset, y: screwOffset }
      ];
      
      screwPositions.forEach(offset => {
        graphics.circle(
          pos.x * this.scale + offset.x,
          pos.y * this.scale + offset.y,
          screwSize
        );
        graphics.fill({ color: 0x4A4A4A });
      });
      
      graphics.zIndex = 30;
      this.ventSprites.set(vent.id, graphics);
      this.container.addChild(graphics);
    });
  }

  /**
   * Render task locations
   */
  private renderTasks(): void {
    POLY3_MAP_DATA.tasks.forEach((task, index) => {
      const graphics = new PIXI.Graphics();
      const pos = task.position;
      const size = 8;
      
      // Determine task color based on type
      let color = 0xFFFF00; // Default yellow
      if (task.type === 'Submit Scan' || task.type === 'Clear Asteroids' || task.type === 'Prime Shields') {
        color = 0x00FF00; // Green for visual tasks
      }
      
      // Task indicator - small circle
      graphics.setStrokeStyle({ width: 2, color: color, alpha: 0.8 });
      graphics.circle(
        pos.x * this.scale,
        pos.y * this.scale,
        size
      );
      graphics.fill({ color: color, alpha: 0.3 });
      graphics.stroke();
      
      graphics.zIndex = 25;
      this.taskSprites.set(`task_${index}`, graphics);
      this.container.addChild(graphics);
    });
  }

  /**
   * Helper function to draw a polygon
   */
  private drawPolygon(
    graphics: PIXI.Graphics, 
    vertices: Point[], 
    fillColor: number, 
    fillAlpha: number,
    showStroke: boolean = false
  ): void {
    if (vertices.length === 0) return;
    
    if (showStroke) {
      graphics.setStrokeStyle({ width: 1, color: 0x3A3A3A, alpha: 0.5 });
    }
    
    graphics.moveTo(vertices[0].x * this.scale, vertices[0].y * this.scale);
    for (let i = 1; i < vertices.length; i++) {
      graphics.lineTo(vertices[i].x * this.scale, vertices[i].y * this.scale);
    }
    graphics.closePath();
    graphics.fill({ color: fillColor, alpha: fillAlpha });
    
    if (showStroke) {
      graphics.stroke();
    }
  }

  /**
   * Update animations
   */
  update(_deltaTime: number): void {
    // Animate vents with a subtle pulse
    this.ventSprites.forEach((ventGraphics) => {
      const pulse = Math.sin(Date.now() * 0.001) * 0.1 + 0.9;
      ventGraphics.alpha = pulse;
    });
    
    // Animate task indicators with a gentle glow
    this.taskSprites.forEach((taskGraphics) => {
      const pulse = Math.sin(Date.now() * 0.002) * 0.2 + 0.8;
      taskGraphics.alpha = pulse;
    });
  }

  /**
   * Get map bounds for camera centering
   */
  getMapBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    POLY3_MAP_DATA.walkableZones.forEach(zone => {
      zone.vertices.forEach(vertex => {
        minX = Math.min(minX, vertex.x);
        minY = Math.min(minY, vertex.y);
        maxX = Math.max(maxX, vertex.x);
        maxY = Math.max(maxY, vertex.y);
      });
    });
    
    return { minX, minY, maxX, maxY };
  }

  /**
   * Get the center point of the map for camera focusing
   */
  getMapCenter(): { x: number; y: number } {
    const bounds = this.getMapBounds();
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2
    };
  }
}
