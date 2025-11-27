import * as PIXI from 'pixi.js';
import {
  POLY3_MAP_DATA,
  calculateCentroid,
  type Point,
  type WalkableZone,
  type LabeledZone,
  type Obstacle
} from '@shared/data/poly3-map';/**
 * Renderer for the poly 3.json map format
 * Renders walkable zones with cyberpunk-inspired spaceship aesthetic
 * Based on JSON_FORMAT_SPECIFICATION.md
 */
export class Poly3MapRenderer {
  private container: PIXI.Container;
  private walkableGraphics: PIXI.Graphics[] = [];
  private labelGraphics: PIXI.Text[] = [];
  private ventSprites: Map<string, PIXI.Graphics> = new Map();
  private taskSprites: Map<string, PIXI.Graphics> = new Map();
  private obstacleSprites: Map<string, PIXI.Graphics> = new Map();
  private emergencyButtonSprite: PIXI.Container | null = null;
  private glowGraphics: PIXI.Graphics | null = null;
  private scale: number = 1; // Direct pixel mapping from JSON

  // Room color mapping - cyberpunk-inspired with subtle color variations
  // Slightly more saturated, with hints of neon undertones
  private readonly ROOM_COLORS: Record<string, { base: number; accent: number; floor: number; glow: number }> = {
    'Reactor': { base: 0x2A4A4A, accent: 0x00FFFF, floor: 0x1E3535, glow: 0x00CCCC },
    'Upper Engine': { base: 0x4A3525, accent: 0xFF6600, floor: 0x352518, glow: 0xCC5500 },
    'Lower Engine': { base: 0x4A3525, accent: 0xFF6600, floor: 0x352518, glow: 0xCC5500 },
    'Security': { base: 0x353540, accent: 0x8888FF, floor: 0x252530, glow: 0x6666CC },
    'MedBay': { base: 0x2A4545, accent: 0x00FFCC, floor: 0x1E3535, glow: 0x00CCAA },
    'Electrical': { base: 0x454530, accent: 0xFFFF00, floor: 0x353520, glow: 0xCCCC00 },
    'Cafeteria': { base: 0x404045, accent: 0xCCCCFF, floor: 0x303035, glow: 0x9999CC },
    'Storage': { base: 0x403530, accent: 0xFFAA55, floor: 0x302520, glow: 0xCC8844 },
    'Admin': { base: 0x3A3530, accent: 0xAAFF55, floor: 0x2A2520, glow: 0x88CC44 },
    'Communications': { base: 0x303545, accent: 0x55AAFF, floor: 0x202535, glow: 0x4488CC },
    'O2': { base: 0x304045, accent: 0x55FFAA, floor: 0x203035, glow: 0x44CC88 },
    'Navigation': { base: 0x253545, accent: 0x5588FF, floor: 0x152535, glow: 0x4466CC },
    'Weapons': { base: 0x253040, accent: 0xFF5555, floor: 0x152030, glow: 0xCC4444 },
    'Shields': { base: 0x454035, accent: 0xFFFF55, floor: 0x353025, glow: 0xCCCC44 }
  };

  // Default color for hallways/corridors - darker with cyan undertone
  private readonly HALLWAY_COLORS = { base: 0x252530, accent: 0x00AAAA, floor: 0x1A1A22, glow: 0x008888 };
  
  // Color for obstacle holes (walls/structures)
  private readonly WALL_COLOR: number = 0x0A0A12;
  private readonly WALL_EDGE_COLOR: number = 0x303040;
  
  // Cyberpunk accent colors
  private readonly NEON_CYAN: number = 0x00FFFF;

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
    this.obstacleSprites.clear();
    this.emergencyButtonSprite = null;
    this.glowGraphics = null;

    // Add layers in order (back to front)
    this.renderBackground();
    this.renderWalkableZonesWithRoomColors(); // Base floor with room colors
    this.renderFloorDetails(); // Subtle grid pattern
    this.renderNeonAccents(); // Cyberpunk glow lines along edges
    this.renderWallEdges(); // Wall outlines for depth
    this.renderLabeledZoneText(); // Room labels with glow
    this.renderObstacles(); // Tables, chairs, etc.
    this.renderVents();
    this.renderTasks();
    this.renderEmergencyButton(); // Emergency button in cafeteria
  }  private renderBackground(): void {
    const bg = new PIXI.Graphics();
    bg.rect(-500, -500, 4000, 3000);
    bg.fill(0x05050A); // Very dark blue-black (deep space)
    bg.zIndex = -100;
    this.container.addChild(bg);
  }

  /**
   * Render subtle floor grid pattern - less prominent for cyberpunk look
   */
  private renderFloorDetails(): void {
    const detailsGraphics = new PIXI.Graphics();
    const gridSize = 50; // Slightly larger grid
    
    // Get bounds of walkable area
    const bounds = this.getMapBounds();
    
    // Draw very subtle grid lines - almost invisible, just adds texture
    detailsGraphics.setStrokeStyle({ width: 1, color: 0x151520, alpha: 0.4 });
    
    // Vertical lines
    for (let x = Math.floor(bounds.minX / gridSize) * gridSize; x <= bounds.maxX; x += gridSize) {
      detailsGraphics.moveTo(x, bounds.minY);
      detailsGraphics.lineTo(x, bounds.maxY);
    }
    
    // Horizontal lines
    for (let y = Math.floor(bounds.minY / gridSize) * gridSize; y <= bounds.maxY; y += gridSize) {
      detailsGraphics.moveTo(bounds.minX, y);
      detailsGraphics.lineTo(bounds.maxX, y);
    }
    detailsGraphics.stroke();
    
    // Create mask from walkable zones
    const floorMask = this.createWalkableMask();
    detailsGraphics.mask = floorMask;
    
    detailsGraphics.zIndex = -3;
    this.container.addChild(floorMask);
    this.container.addChild(detailsGraphics);
  }

  /**
   * Render wall edges for depth and definition - with subtle glow
   */
  private renderWallEdges(): void {
    const edgeGraphics = new PIXI.Graphics();
    
    // Draw outlines around walkable zone boundaries
    POLY3_MAP_DATA.walkableZones.forEach((zone: WalkableZone) => {
      // Outer boundary - darker edge
      this.drawPolygonOutline(edgeGraphics, zone.vertices, this.WALL_EDGE_COLOR, 2, 0.9);
      
      // Hole boundaries - these are internal walls/obstacles
      zone.holes.forEach((hole: Point[]) => {
        this.drawPolygonOutline(edgeGraphics, hole, this.WALL_EDGE_COLOR, 2, 0.7);
      });
    });
    
    edgeGraphics.zIndex = -1;
    this.container.addChild(edgeGraphics);
  }

  /**
   * Render cyberpunk neon accent lines along room edges
   */
  private renderNeonAccents(): void {
    this.glowGraphics = new PIXI.Graphics();
    
    // Add subtle neon glow lines along labeled zone boundaries
    POLY3_MAP_DATA.labeledZones.forEach((zone: LabeledZone) => {
      const roomColors = this.ROOM_COLORS[zone.name];
      if (!roomColors) return;
      
      const glowColor = roomColors.glow;
      
      // Draw a soft glow line along the room boundary (only a portion for style)
      // We'll draw accent lines on some edges, not all
      const vertices = zone.vertices;
      if (vertices.length < 2) return;
      
      // Draw glow on alternating/select edges for a subtle effect
      for (let i = 0; i < vertices.length; i++) {
        // Only draw on some edges for a more subtle look
        if (i % 3 !== 0) continue;
        
        const start = vertices[i];
        const end = vertices[(i + 1) % vertices.length];
        
        // Calculate edge length
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        // Only draw on longer edges
        if (length < 50) continue;
        
        // Draw soft glow (multiple lines with decreasing alpha)
        for (let g = 0; g < 3; g++) {
          const alpha = 0.15 - g * 0.04;
          const width = 4 - g;
          this.glowGraphics!.setStrokeStyle({ width, color: glowColor, alpha });
          this.glowGraphics!.moveTo(start.x * this.scale, start.y * this.scale);
          this.glowGraphics!.lineTo(end.x * this.scale, end.y * this.scale);
          this.glowGraphics!.stroke();
        }
      }
    });
    
    // Create walkable mask for glow
    const glowMask = this.createWalkableMask();
    this.glowGraphics!.mask = glowMask;
    
    this.glowGraphics!.zIndex = -2;
    this.container.addChild(glowMask);
    this.container.addChild(this.glowGraphics!);
  }

  /**
   * Create a mask graphics object from walkable zones
   */
  private createWalkableMask(): PIXI.Graphics {
    const mask = new PIXI.Graphics();
    
    POLY3_MAP_DATA.walkableZones.forEach((walkableZone: WalkableZone) => {
      if (walkableZone.vertices.length > 0) {
        mask.moveTo(
          walkableZone.vertices[0].x * this.scale, 
          walkableZone.vertices[0].y * this.scale
        );
        for (let i = 1; i < walkableZone.vertices.length; i++) {
          mask.lineTo(
            walkableZone.vertices[i].x * this.scale, 
            walkableZone.vertices[i].y * this.scale
          );
        }
        mask.closePath();
        mask.fill({ color: 0xFFFFFF });
        
        // Cut out holes
        walkableZone.holes.forEach((hole: Point[]) => {
          if (hole.length > 0) {
            mask.moveTo(hole[0].x * this.scale, hole[0].y * this.scale);
            for (let i = 1; i < hole.length; i++) {
              mask.lineTo(hole[i].x * this.scale, hole[i].y * this.scale);
            }
            mask.closePath();
            mask.cut();
          }
        });
      }
    });
    
    return mask;
  }

  /**
   * Draw polygon outline (stroke only)
   */
  private drawPolygonOutline(
    graphics: PIXI.Graphics,
    vertices: Point[],
    color: number,
    width: number,
    alpha: number
  ): void {
    if (vertices.length < 2) return;
    
    graphics.setStrokeStyle({ width, color, alpha });
    graphics.moveTo(vertices[0].x * this.scale, vertices[0].y * this.scale);
    for (let i = 1; i < vertices.length; i++) {
      graphics.lineTo(vertices[i].x * this.scale, vertices[i].y * this.scale);
    }
    graphics.closePath();
    graphics.stroke();
  }

  /**
   * Render walkable zones with room colors applied via intersection
   * The walkable area is colored based on which labeled zone (room) it intersects with
   * Hallways (areas not in any labeled zone) use the default hallway color
   */
  private renderWalkableZonesWithRoomColors(): void {
    // First, render the base walkable area with hallway floor color
    const baseGraphics = new PIXI.Graphics();
    
    POLY3_MAP_DATA.walkableZones.forEach((zone: WalkableZone) => {
      // Draw the main walkable zone polygon with hallway floor color
      this.drawPolygonOnGraphics(baseGraphics, zone.vertices, this.HALLWAY_COLORS.floor, 1.0);
      
      // Draw holes (obstacles/walls) - these are non-walkable areas
      zone.holes.forEach((hole: Point[]) => {
        this.drawPolygonOnGraphics(baseGraphics, hole, this.WALL_COLOR, 1.0);
      });
    });
    
    baseGraphics.zIndex = -10;
    this.walkableGraphics.push(baseGraphics);
    this.container.addChild(baseGraphics);
    
    // Now render each labeled zone's color, but ONLY where it intersects with walkable area
    POLY3_MAP_DATA.labeledZones.forEach((labeledZone: LabeledZone) => {
      const roomColors = this.ROOM_COLORS[labeledZone.name];
      if (!roomColors) return; // Skip if no color defined
      
      // Create the room colored shape with floor color
      const roomGraphics = new PIXI.Graphics();
      this.drawPolygonOnGraphics(roomGraphics, labeledZone.vertices, roomColors.floor, 1.0);
      
      // Create a mask from the walkable zones (including cutting out holes)
      const walkableMask = this.createWalkableMaskForRoom();
      
      // Apply the walkable mask to the room graphics
      roomGraphics.mask = walkableMask;
      roomGraphics.zIndex = -5;
      
      // Add mask to container (required for masking to work)
      this.container.addChild(walkableMask);
      this.container.addChild(roomGraphics);
    });
  }

  /**
   * Create walkable mask for room coloring
   */
  private createWalkableMaskForRoom(): PIXI.Graphics {
    const walkableMask = new PIXI.Graphics();
    
    POLY3_MAP_DATA.walkableZones.forEach((walkableZone: WalkableZone) => {
      if (walkableZone.vertices.length > 0) {
        walkableMask.moveTo(
          walkableZone.vertices[0].x * this.scale, 
          walkableZone.vertices[0].y * this.scale
        );
        for (let i = 1; i < walkableZone.vertices.length; i++) {
          walkableMask.lineTo(
            walkableZone.vertices[i].x * this.scale, 
            walkableZone.vertices[i].y * this.scale
          );
        }
        walkableMask.closePath();
        walkableMask.fill({ color: 0xFFFFFF });
        
        // Cut out holes (obstacles)
        walkableZone.holes.forEach((hole: Point[]) => {
          if (hole.length > 0) {
            walkableMask.moveTo(hole[0].x * this.scale, hole[0].y * this.scale);
            for (let i = 1; i < hole.length; i++) {
              walkableMask.lineTo(hole[i].x * this.scale, hole[i].y * this.scale);
            }
            walkableMask.closePath();
            walkableMask.cut();
          }
        });
      }
    });
    
    return walkableMask;
  }

  /**
   * Helper to draw a polygon on an existing graphics object
   */
  private drawPolygonOnGraphics(
    graphics: PIXI.Graphics, 
    vertices: Point[], 
    fillColor: number, 
    fillAlpha: number
  ): void {
    if (vertices.length === 0) return;
    
    graphics.moveTo(vertices[0].x * this.scale, vertices[0].y * this.scale);
    for (let i = 1; i < vertices.length; i++) {
      graphics.lineTo(vertices[i].x * this.scale, vertices[i].y * this.scale);
    }
    graphics.closePath();
    graphics.fill({ color: fillColor, alpha: fillAlpha });
  }

  /**
   * Render labeled zone text labels at their centers
   * Styled with cyberpunk glow effect
   */
  private renderLabeledZoneText(): void {
    POLY3_MAP_DATA.labeledZones.forEach((zone: LabeledZone) => {
      // Calculate center point of the zone
      const center = calculateCentroid(zone.vertices);
      const roomColors = this.ROOM_COLORS[zone.name];
      const glowColor = roomColors?.glow || this.NEON_CYAN;
      
      // Convert glow color to hex string for text style
      const glowHex = glowColor;
      
      // Create text label for the room name - uppercase cyberpunk style
      const label = new PIXI.Text({
        text: zone.name.toUpperCase(),
        style: {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: 16,
          fill: 0xDDDDDD,
          stroke: { color: 0x000000, width: 4 },
          align: 'center',
          fontWeight: 'bold',
          letterSpacing: 3,
          dropShadow: {
            color: glowHex,
            blur: 8,
            distance: 0,
            alpha: 0.5
          }
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
   * Render vents at their specified positions - cyberpunk style with glow
   */
  private renderVents(): void {
    POLY3_MAP_DATA.vents.forEach(vent => {
      const graphics = new PIXI.Graphics();
      const pos = vent.position;
      const size = 26; // Vent size in pixels
      
      // Outer glow effect
      graphics.roundRect(
        pos.x * this.scale - size / 2 - 2,
        pos.y * this.scale - size / 2 - 2,
        size + 4,
        size + 4,
        4
      );
      graphics.fill({ color: this.NEON_CYAN, alpha: 0.15 });
      
      // Vent shadow/depth
      graphics.roundRect(
        pos.x * this.scale - size / 2 + 2,
        pos.y * this.scale - size / 2 + 2,
        size,
        size,
        3
      );
      graphics.fill({ color: 0x000000, alpha: 0.5 });
      
      // Vent frame - dark metal with cyan accent
      graphics.setStrokeStyle({ width: 2, color: 0x003333 });
      graphics.roundRect(
        pos.x * this.scale - size / 2,
        pos.y * this.scale - size / 2,
        size,
        size,
        3
      );
      graphics.fill({ color: 0x151520 });
      graphics.stroke();
      
      // Inner darker area
      const innerSize = size - 6;
      graphics.roundRect(
        pos.x * this.scale - innerSize / 2,
        pos.y * this.scale - innerSize / 2,
        innerSize,
        innerSize,
        2
      );
      graphics.fill({ color: 0x0A0A10 });
      
      // Grill lines (horizontal) - metal slats
      graphics.setStrokeStyle({ width: 2, color: 0x252530 });
      for (let i = 0; i < 4; i++) {
        const y = pos.y * this.scale - innerSize / 2 + (i + 1) * (innerSize / 5);
        graphics.moveTo(pos.x * this.scale - innerSize / 2 + 1, y);
        graphics.lineTo(pos.x * this.scale + innerSize / 2 - 1, y);
      }
      graphics.stroke();
      
      // Corner bolts
      const boltSize = 2;
      const boltOffset = size / 2 - 4;
      const boltPositions = [
        { x: -boltOffset, y: -boltOffset },
        { x: boltOffset, y: -boltOffset },
        { x: -boltOffset, y: boltOffset },
        { x: boltOffset, y: boltOffset }
      ];
      
      boltPositions.forEach(offset => {
        graphics.circle(
          pos.x * this.scale + offset.x,
          pos.y * this.scale + offset.y,
          boltSize
        );
        graphics.fill({ color: 0x3A3A40 });
        graphics.setStrokeStyle({ width: 0.5, color: 0x505060 });
        graphics.stroke();
      });
      
      graphics.zIndex = 30;
      this.ventSprites.set(vent.id, graphics);
      this.container.addChild(graphics);
    });
  }

  /**
   * Render task locations - cyberpunk style with subtle glow
   */
  private renderTasks(): void {
    POLY3_MAP_DATA.tasks.forEach((task, index) => {
      const graphics = new PIXI.Graphics();
      const pos = task.position;
      const size = 5;
      
      // Determine task color - neon-inspired
      let color = 0xFFCC00; // Golden yellow
      let glowColor = 0xFFAA00;
      if (task.type === 'Submit Scan' || task.type === 'Clear Asteroids' || task.type === 'Prime Shields') {
        color = 0x00FF88; // Neon green for visual tasks
        glowColor = 0x00CC66;
      }
      
      // Outer glow
      graphics.circle(
        pos.x * this.scale,
        pos.y * this.scale,
        size + 4
      );
      graphics.fill({ color: glowColor, alpha: 0.15 });
      
      // Inner dot
      graphics.circle(
        pos.x * this.scale,
        pos.y * this.scale,
        size
      );
      graphics.fill({ color: color, alpha: 0.6 });
      
      // Bright center
      graphics.circle(
        pos.x * this.scale,
        pos.y * this.scale,
        size - 2
      );
      graphics.fill({ color: 0xFFFFFF, alpha: 0.3 });
      
      // Outer ring
      graphics.setStrokeStyle({ width: 1, color: color, alpha: 0.8 });
      graphics.circle(
        pos.x * this.scale,
        pos.y * this.scale,
        size + 2
      );
      graphics.stroke();
      
      graphics.zIndex = 25;
      this.taskSprites.set(`task_${index}`, graphics);
      this.container.addChild(graphics);
    });
  }

  /**
   * Render obstacles (tables, chairs, etc.) - cyberpunk furniture style
   */
  private renderObstacles(): void {
    const obstacles = POLY3_MAP_DATA.obstacles || [];

    // Obstacle type colors - dark metallic cyberpunk aesthetic
    const obstacleColors: Record<string, { base: number; edge: number; glow: number }> = {
      'table': { base: 0x2A1F1A, edge: 0x8B4513, glow: 0xD2691E },
      'chair': { base: 0x1A1A1A, edge: 0x4A4A4A, glow: 0x808080 },
      'console': { base: 0x1A2A2A, edge: 0x2F4F4F, glow: 0x00CED1 },
      'bed': { base: 0x1A1A2A, edge: 0x4B0082, glow: 0x9370DB }
    };

    obstacles.forEach((obstacle: Obstacle) => {
      const graphics = new PIXI.Graphics();
      const x = obstacle.position.x * this.scale;
      const y = obstacle.position.y * this.scale;
      const hw = (obstacle.width / 2) * this.scale;
      const hh = (obstacle.height / 2) * this.scale;

      const colors = obstacleColors[obstacle.type] || obstacleColors['table'];

      // Outer glow (subtle cyberpunk effect)
      graphics.roundRect(x - hw - 3, y - hh - 3, obstacle.width * this.scale + 6, obstacle.height * this.scale + 6, 4);
      graphics.fill({ color: colors.glow, alpha: 0.15 });

      // Main body with rounded corners
      graphics.roundRect(x - hw, y - hh, obstacle.width * this.scale, obstacle.height * this.scale, 3);
      graphics.fill({ color: colors.base, alpha: 0.95 });

      // Edge highlight
      graphics.setStrokeStyle({ width: 2, color: colors.edge, alpha: 0.8 });
      graphics.roundRect(x - hw, y - hh, obstacle.width * this.scale, obstacle.height * this.scale, 3);
      graphics.stroke();

      // Inner detail line (gives depth)
      graphics.setStrokeStyle({ width: 1, color: colors.glow, alpha: 0.3 });
      graphics.roundRect(x - hw + 4, y - hh + 4, obstacle.width * this.scale - 8, obstacle.height * this.scale - 8, 2);
      graphics.stroke();

      // For tables, add a subtle surface pattern
      if (obstacle.type === 'table') {
        // Center dot/button detail
        graphics.circle(x, y, 5);
        graphics.fill({ color: colors.glow, alpha: 0.4 });
      }

      graphics.zIndex = 20;
      this.obstacleSprites.set(obstacle.id, graphics);
      this.container.addChild(graphics);
    });
  }

  /**
   * Render the emergency button - prominent red button with glow
   */
  private renderEmergencyButton(): void {
    const emergencyButton = POLY3_MAP_DATA.emergencyButton;
    if (!emergencyButton) return;

    const buttonContainer = new PIXI.Container();
    const x = emergencyButton.position.x * this.scale;
    const y = emergencyButton.position.y * this.scale;

    // Outer glow (pulsing red aura)
    const outerGlow = new PIXI.Graphics();
    outerGlow.circle(x, y, 25);
    outerGlow.fill({ color: 0xFF0000, alpha: 0.2 });
    buttonContainer.addChild(outerGlow);

    // Button base (dark red platform)
    const base = new PIXI.Graphics();
    base.circle(x, y, 20);
    base.fill({ color: 0x660000, alpha: 0.95 });
    base.setStrokeStyle({ width: 3, color: 0x880000 });
    base.stroke();
    buttonContainer.addChild(base);

    // Button top (bright red)
    const button = new PIXI.Graphics();
    button.circle(x, y, 14);
    button.fill({ color: 0xFF0000, alpha: 1.0 });
    button.setStrokeStyle({ width: 2, color: 0xFFFFFF, alpha: 0.5 });
    button.stroke();
    buttonContainer.addChild(button);

    // Highlight (gives 3D effect)
    const highlight = new PIXI.Graphics();
    highlight.circle(x - 3, y - 3, 6);
    highlight.fill({ color: 0xFFFFFF, alpha: 0.4 });
    buttonContainer.addChild(highlight);

    // "!" symbol
    const exclamation = new PIXI.Text({
      text: '!',
      style: {
        fontFamily: 'Arial',
        fontSize: 18,
        fill: 0xFFFFFF,
        fontWeight: 'bold'
      }
    });
    exclamation.anchor.set(0.5);
    exclamation.position.set(x, y);
    buttonContainer.addChild(exclamation);

    // Label below button
    const label = new PIXI.Text({
      text: 'EMERGENCY',
      style: {
        fontFamily: 'Arial',
        fontSize: 30,
        fill: 0xFF4444,
        fontWeight: 'bold'
      }
    });
    label.anchor.set(0.5, 0);
    label.position.set(x, y + 28);
    buttonContainer.addChild(label);

    buttonContainer.zIndex = 30;
    this.emergencyButtonSprite = buttonContainer;
    this.container.addChild(buttonContainer);
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

    // Animate emergency button with a pulsing red glow
    if (this.emergencyButtonSprite && this.emergencyButtonSprite.children.length > 0) {
      const outerGlow = this.emergencyButtonSprite.children[0] as PIXI.Graphics;
      const pulse = Math.sin(Date.now() * 0.003) * 0.15 + 0.25;
      outerGlow.alpha = pulse;
    }
  }  /**
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
