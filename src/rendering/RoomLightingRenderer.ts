import * as PIXI from 'pixi.js';
import { 
  POLY3_MAP_DATA, 
  calculateCentroid, 
  type Point, 
  type LabeledZone,
  isPointWalkable
} from '@shared/data/poly3-map';

/**
 * Configuration for a single light source
 */
interface LightConfig {
  position: Point;
  radius: number;
  color: number;
  intensity: number;
}

/**
 * Ray-traced room lighting renderer
 * Creates subtle, soft illumination that respects walls and obstacles
 * Uses canvas radial gradients masked by ray-traced shapes for proper wall occlusion
 */
export class RoomLightingRenderer {
  private container: PIXI.Container;
  private lightContainer: PIXI.Container;
  private lightsEnabled: boolean = true;
  private lightSprites: PIXI.Sprite[] = [];
  private gradientTextures: Map<string, PIXI.Texture> = new Map();
  
  // Store all light configurations for brightness calculations
  private allLights: LightConfig[] = [];
  
  // Number of rays to cast for each light (higher = smoother edges at walls)
  private readonly RAY_COUNT = 90;
  
  // Step size for ray marching (smaller = more precise wall detection)
  private readonly RAY_STEP = 3;
  
  // Maximum light radius
  private readonly MAX_LIGHT_RADIUS = 280;
  
  // Almost all lights are soft white
  // Only Navigation and Electrical have very slight color tints
  private readonly ROOM_LIGHT_COLORS: Record<string, number> = {
    'Reactor': 0xFFFFFF,
    'Upper Engine': 0xFFFFFF,
    'Lower Engine': 0xFFFFFF,
    'Security': 0xFFFFFF,
    'MedBay': 0xFFFFFF,
    'Electrical': 0xFFFFF8,     // Very slight warm
    'Cafeteria': 0xFFFFFF,
    'Storage': 0xFFFFFF,
    'Admin': 0xFFFFFF,
    'Communications': 0xFFFFFF,
    'O2': 0xFFFFFF,
    'Navigation': 0xF8F8FF,     // Very slight cool
    'Weapons': 0xFFFFFF,
    'Shields': 0xFFFFFF
  };

  constructor() {
    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
    
    this.lightContainer = new PIXI.Container();
    this.lightContainer.zIndex = -4;
    this.container.addChild(this.lightContainer);
  }

  getContainer(): PIXI.Container {
    return this.container;
  }

  // ============================================
  // LIGHTS ON/OFF API (for sabotage mechanics)
  // ============================================

  /**
   * Enable or disable lighting (for sabotage)
   */
  setLightsEnabled(enabled: boolean): void {
    this.lightsEnabled = enabled;
  }

  /**
   * Check if lights are currently on
   */
  areLightsOn(): boolean {
    return this.lightsEnabled;
  }

  /**
   * Toggle lights on/off
   */
  toggleLights(): void {
    this.setLightsEnabled(!this.lightsEnabled);
  }

  // ============================================
  // BRIGHTNESS CALCULATION (for color confidence)
  // ============================================

  /**
   * Calculate the brightness at a given position based on all lights
   * Returns a value between 0 (complete darkness) and 1 (full brightness)
   * Used for determining color confidence when lights are on/off
   */
  getBrightnessAtPosition(x: number, y: number): number {
    // If lights are off, return very low brightness
    if (!this.lightsEnabled) {
      return 0.08; // Minimal ambient light
    }

    // Calculate cumulative brightness from all lights
    let totalBrightness = 0.15; // Ambient light base

    for (const light of this.allLights) {
      const dx = x - light.position.x;
      const dy = y - light.position.y;
      const distanceSq = dx * dx + dy * dy;
      const distance = Math.sqrt(distanceSq);
      
      if (distance < light.radius) {
        // Light falloff - inverse square-ish with smoothing
        const normalizedDist = distance / light.radius;
        // Smooth falloff curve
        const falloff = 1 - (normalizedDist * normalizedDist);
        totalBrightness += light.intensity * falloff * 8; // Boost factor
      }
    }

    // Clamp to reasonable range
    return Math.min(1.0, totalBrightness);
  }

  /**
   * Get color confidence percentage based on brightness
   * Higher brightness = more confident in identifying the player's color
   */
  getColorConfidenceAtPosition(x: number, y: number): number {
    const brightness = this.getBrightnessAtPosition(x, y);
    
    // Map brightness to confidence (0-100%)
    // At full brightness, 95-100% confidence
    // At low brightness, 15-40% confidence
    if (brightness >= 0.8) {
      return 0.95 + (brightness - 0.8) * 0.25; // 95-100%
    } else if (brightness >= 0.5) {
      return 0.70 + (brightness - 0.5) * 0.83; // 70-95%
    } else if (brightness >= 0.2) {
      return 0.40 + (brightness - 0.2) * 1.0; // 40-70%
    } else {
      return 0.15 + brightness * 1.25; // 15-40%
    }
  }

  // ============================================
  // MAIN RENDERING
  // ============================================

  /**
   * Render all room lights
   */
  renderLights(): void {
    this.lightContainer.removeChildren();
    this.lightSprites = [];
    this.allLights = []; // Reset light list
    
    // Render lights for each labeled room
    POLY3_MAP_DATA.labeledZones.forEach((zone: LabeledZone) => {
      const lights = this.calculateLightsForRoom(zone);
      lights.forEach(light => {
        this.allLights.push(light); // Track all lights
        this.renderRayTracedLight(light);
      });
    });
    
    // Add hallway lights
    this.renderHallwayLights();
  }

  /**
   * Calculate optimal light positions for a room based on its area
   * Double the lights to give rooms a proper illuminated feel
   */
  private calculateLightsForRoom(zone: LabeledZone): LightConfig[] {
    const lights: LightConfig[] = [];
    const area = this.calculatePolygonArea(zone.vertices);
    const centroid = calculateCentroid(zone.vertices);
    const lightColor = this.ROOM_LIGHT_COLORS[zone.name] || 0xFFFFFF;
    
    // Double the light count for better room coverage
    let lightCount: number;
    let baseRadius: number;
    let intensity: number;
    
    if (area < 15000) {
      lightCount = 2;  // Was 1
      baseRadius = Math.min(this.MAX_LIGHT_RADIUS, Math.sqrt(area) * 1.6);
      intensity = 0.07;
    } else if (area < 40000) {
      lightCount = 4;  // Was 2
      baseRadius = Math.min(this.MAX_LIGHT_RADIUS, Math.sqrt(area) * 1.2);
      intensity = 0.06;
    } else {
      lightCount = 6;  // Was 3
      baseRadius = Math.min(this.MAX_LIGHT_RADIUS, Math.sqrt(area) * 1.0);
      intensity = 0.05;
    }
    
    // Generate light positions spread across the room
    const spread = this.calculateSpreadPositions(zone.vertices, centroid, lightCount);
    spread.forEach(pos => {
      lights.push({
        position: pos,
        radius: baseRadius,
        color: lightColor,
        intensity
      });
    });
    
    return lights;
  }

  /**
   * Calculate spread positions for multiple lights within a polygon
   * Handles 2, 4, or 6 lights with good distribution
   */
  private calculateSpreadPositions(vertices: Point[], centroid: Point, count: number): Point[] {
    const positions: Point[] = [];
    const bounds = this.getPolygonBounds(vertices);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    
    if (count === 2) {
      // Two lights spread along longest axis
      if (width > height) {
        const offsetX = width * 0.20;
        positions.push({ x: centroid.x - offsetX, y: centroid.y });
        positions.push({ x: centroid.x + offsetX, y: centroid.y });
      } else {
        const offsetY = height * 0.20;
        positions.push({ x: centroid.x, y: centroid.y - offsetY });
        positions.push({ x: centroid.x, y: centroid.y + offsetY });
      }
    } else if (count === 4) {
      // Four lights in a cross/diamond pattern
      const offsetX = width * 0.20;
      const offsetY = height * 0.20;
      positions.push({ x: centroid.x - offsetX, y: centroid.y });
      positions.push({ x: centroid.x + offsetX, y: centroid.y });
      positions.push({ x: centroid.x, y: centroid.y - offsetY });
      positions.push({ x: centroid.x, y: centroid.y + offsetY });
    } else if (count >= 6) {
      // Six lights in a hexagonal pattern
      const radius = Math.min(width, height) * 0.22;
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
        positions.push({
          x: centroid.x + Math.cos(angle) * radius,
          y: centroid.y + Math.sin(angle) * radius
        });
      }
    } else {
      // Fallback: circular distribution
      const radius = Math.min(width, height) * 0.18;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        positions.push({
          x: centroid.x + Math.cos(angle) * radius,
          y: centroid.y + Math.sin(angle) * radius
        });
      }
    }
    
    // Validate all positions are walkable, fallback to centroid if not
    return positions.map(pos => 
      isPointWalkable(pos.x, pos.y, POLY3_MAP_DATA.walkableZones) ? pos : centroid
    );
  }

  // ============================================
  // RAY-TRACED LIGHT RENDERING
  // ============================================

  /**
   * Render a single ray-traced light with smooth canvas gradient
   * The gradient is masked by the ray-traced boundary so light stops at walls
   */
  private renderRayTracedLight(light: LightConfig): void {
    // Cast rays to find where light hits walls
    const boundaryPoints = this.castLightRays(light.position, light.radius);
    if (boundaryPoints.length < 3) return;
    
    // Create container for this light
    const lightGroup = new PIXI.Container();
    
    // Create smooth gradient sprite (canvas-based radial gradient)
    const gradientSprite = this.createGradientSprite(light);
    
    // Create mask from ray-traced boundary - light stops at walls
    const mask = this.createLightMask(boundaryPoints);
    
    // Apply mask so gradient only shows within ray-traced area
    gradientSprite.mask = mask;
    
    lightGroup.addChild(mask);
    lightGroup.addChild(gradientSprite);
    
    this.lightContainer.addChild(lightGroup);
    this.lightSprites.push(gradientSprite);
  }

  /**
   * Cast rays from light source to find wall boundaries
   */
  private castLightRays(origin: Point, maxRadius: number): Point[] {
    const points: Point[] = [];
    const angleStep = (Math.PI * 2) / this.RAY_COUNT;
    
    for (let i = 0; i < this.RAY_COUNT; i++) {
      const angle = i * angleStep;
      const hitPoint = this.castSingleRay(origin, angle, maxRadius);
      points.push(hitPoint);
    }
    
    return points;
  }

  /**
   * Cast a single ray and find where it hits a wall
   * Uses step-based marching to properly detect inner walls (holes)
   */
  private castSingleRay(origin: Point, angle: number, maxDistance: number): Point {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    
    // March along the ray in small steps
    let distance = 0;
    let lastWalkable = origin;
    
    while (distance < maxDistance) {
      distance += this.RAY_STEP;
      const testPoint = { 
        x: origin.x + dx * distance, 
        y: origin.y + dy * distance 
      };
      
      if (isPointWalkable(testPoint.x, testPoint.y, POLY3_MAP_DATA.walkableZones)) {
        lastWalkable = testPoint;
      } else {
        // Hit a wall - return the last walkable point
        return lastWalkable;
      }
    }
    
    // Reached max distance without hitting wall
    return { x: origin.x + dx * maxDistance, y: origin.y + dy * maxDistance };
  }

  /**
   * Create a smooth radial gradient sprite using canvas
   * This gives us a true smooth gradient, not rings
   */
  private createGradientSprite(light: LightConfig): PIXI.Sprite {
    const size = Math.ceil(light.radius * 2);
    const textureKey = `light_${size}_${light.color.toString(16)}_${Math.round(light.intensity * 100)}`;
    
    let texture = this.gradientTextures.get(textureKey);
    
    if (!texture) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      
      // Extract RGB
      const r = (light.color >> 16) & 0xFF;
      const g = (light.color >> 8) & 0xFF;
      const b = light.color & 0xFF;
      
      // Create smooth radial gradient
      const gradient = ctx.createRadialGradient(
        size / 2, size / 2, 0,           // Center point
        size / 2, size / 2, size / 2     // Edge
      );
      
      // Very soft, smooth falloff - like real light
      // Intensity is highest at center, fades to zero at edges
      const maxAlpha = light.intensity;
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${maxAlpha})`);
      gradient.addColorStop(0.15, `rgba(${r}, ${g}, ${b}, ${maxAlpha * 0.75})`);
      gradient.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, ${maxAlpha * 0.45})`);
      gradient.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${maxAlpha * 0.22})`);
      gradient.addColorStop(0.75, `rgba(${r}, ${g}, ${b}, ${maxAlpha * 0.08})`);
      gradient.addColorStop(0.9, `rgba(${r}, ${g}, ${b}, ${maxAlpha * 0.02})`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      
      texture = PIXI.Texture.from(canvas);
      this.gradientTextures.set(textureKey, texture);
    }
    
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(light.position.x, light.position.y);
    
    return sprite;
  }

  /**
   * Create a mask from ray-traced boundary points
   * This is what prevents light from going through walls
   */
  private createLightMask(boundaryPoints: Point[]): PIXI.Graphics {
    const mask = new PIXI.Graphics();
    
    if (boundaryPoints.length < 3) return mask;
    
    mask.moveTo(boundaryPoints[0].x, boundaryPoints[0].y);
    for (let i = 1; i < boundaryPoints.length; i++) {
      mask.lineTo(boundaryPoints[i].x, boundaryPoints[i].y);
    }
    mask.closePath();
    mask.fill({ color: 0xFFFFFF });
    
    return mask;
  }

  /**
   * Render lights for hallway areas
   */
  private renderHallwayLights(): void {
    const hallwayLights: LightConfig[] = [
      // Upper hallway
      { position: { x: 540, y: 440 }, radius: 110, color: 0xFFFFFF, intensity: 0.06 },
      { position: { x: 400, y: 440 }, radius: 90, color: 0xFFFFFF, intensity: 0.05 },
      
      // Central hallway
      { position: { x: 800, y: 550 }, radius: 120, color: 0xFFFFFF, intensity: 0.06 },
      { position: { x: 1000, y: 550 }, radius: 110, color: 0xFFFFFF, intensity: 0.06 },
      
      // Lower hallway
      { position: { x: 650, y: 900 }, radius: 110, color: 0xFFFFFF, intensity: 0.05 },
      { position: { x: 900, y: 850 }, radius: 100, color: 0xFFFFFF, intensity: 0.05 },
      
      // Navigation corridor
      { position: { x: 1350, y: 620 }, radius: 110, color: 0xFFFFFF, intensity: 0.06 },
      { position: { x: 1500, y: 500 }, radius: 100, color: 0xFFFFFF, intensity: 0.05 }
    ];
    
    hallwayLights.forEach(light => {
      if (isPointWalkable(light.position.x, light.position.y, POLY3_MAP_DATA.walkableZones)) {
        this.allLights.push(light); // Track hallway lights too
        this.renderRayTracedLight(light);
      }
    });
  }

  // ============================================
  // UTILITIES
  // ============================================

  private calculatePolygonArea(vertices: Point[]): number {
    let area = 0;
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += vertices[i].x * vertices[j].y;
      area -= vertices[j].x * vertices[i].y;
    }
    return Math.abs(area / 2);
  }

  private getPolygonBounds(vertices: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    vertices.forEach(v => {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    });
    return { minX, minY, maxX, maxY };
  }

  /**
   * Update - handles smooth fade for lights on/off transitions
   */
  update(_deltaTime: number): void {
    const targetAlpha = this.lightsEnabled ? 1.0 : 0.08; // Very dim when "off"
    const currentAlpha = this.lightContainer.alpha;
    
    // Smooth transition
    if (Math.abs(currentAlpha - targetAlpha) > 0.01) {
      const speed = this.lightsEnabled ? 0.04 : 0.06; // Faster off, slower on
      this.lightContainer.alpha += (targetAlpha - currentAlpha) * speed;
    } else {
      this.lightContainer.alpha = targetAlpha;
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.gradientTextures.forEach(texture => texture.destroy());
    this.gradientTextures.clear();
    this.lightContainer.removeChildren();
    this.lightSprites = [];
  }
}
