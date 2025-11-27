/**
 * Zone Detection System
 * Classifies areas as rooms or hallways and tracks player location
 */

import type { Point, WalkableZone, LabeledZone } from '../data/poly3-map.ts';
import { pointInPolygon, getCurrentZone } from '../data/poly3-map.ts';

export const ZoneType = {
  ROOM: 'ROOM',
  HALLWAY: 'HALLWAY',
  UNKNOWN: 'UNKNOWN'
} as const;
export type ZoneType = typeof ZoneType[keyof typeof ZoneType];

export interface Zone {
  name: string;
  type: ZoneType;
  vertices: Point[];
  center: Point;
  isWalkable: boolean;
}

export interface ZoneTransitionEvent {
  playerId: string;
  fromZone: string | null;
  toZone: string;
  zoneType: ZoneType;
  timestamp: number;
}

export class ZoneDetector {
  private zones: Map<string, Zone>;
  private playerZones: Map<string, string | null>; // playerId -> current zone name
  private labeledZones: LabeledZone[];
  private walkableZones: WalkableZone[];
  
  constructor(walkableZones: WalkableZone[], labeledZones: LabeledZone[]) {
    this.zones = new Map();
    this.playerZones = new Map();
    this.labeledZones = labeledZones;
    this.walkableZones = walkableZones;
    
    this.buildZoneMap();
  }
  
  /**
   * Build the zone map from walkable and labeled zones
   */
  private buildZoneMap(): void {
    // Process walkable zones
    for (const walkableZone of this.walkableZones) {
      const center = this.calculateCentroid(walkableZone.vertices);
      this.zones.set(walkableZone.roomName, {
        name: walkableZone.roomName,
        type: walkableZone.isRoom ? ZoneType.ROOM : ZoneType.HALLWAY,
        vertices: walkableZone.vertices,
        center,
        isWalkable: true
      });
    }
    
    // Also process labeled zones (for additional context)
    for (const labeledZone of this.labeledZones) {
      if (!this.zones.has(labeledZone.name)) {
        const center = this.calculateCentroid(labeledZone.vertices);
        // Infer type from name patterns
        const type = this.inferZoneType(labeledZone.name);
        this.zones.set(labeledZone.name, {
          name: labeledZone.name,
          type,
          vertices: labeledZone.vertices,
          center,
          isWalkable: false
        });
      }
    }
  }
  
  /**
   * Infer zone type from name (room vs hallway)
   */
  private inferZoneType(name: string): ZoneType {
    const lowerName = name.toLowerCase();
    
    // Hallway indicators
    const hallwayKeywords = ['hall', 'corridor', 'passage', 'walkway', 'path'];
    for (const keyword of hallwayKeywords) {
      if (lowerName.includes(keyword)) {
        return ZoneType.HALLWAY;
      }
    }
    
    // Room indicators
    const roomKeywords = ['room', 'office', 'bay', 'engine', 'reactor', 'storage', 
                          'electrical', 'admin', 'cafeteria', 'security', 'medbay',
                          'weapons', 'shields', 'navigation', 'communications', 'o2'];
    for (const keyword of roomKeywords) {
      if (lowerName.includes(keyword)) {
        return ZoneType.ROOM;
      }
    }
    
    return ZoneType.UNKNOWN;
  }
  
  /**
   * Get the zone at a specific position
   */
  getZoneAtPosition(position: Point): Zone | null {
    // Check labeled zones first (more specific)
    const zoneName = getCurrentZone(position.x, position.y, this.labeledZones);
    if (zoneName && this.zones.has(zoneName)) {
      return this.zones.get(zoneName)!;
    }
    
    // Check walkable zones
    for (const walkableZone of this.walkableZones) {
      if (pointInPolygon(position.x, position.y, walkableZone.vertices)) {
        // Check not in holes
        let inHole = false;
        for (const hole of walkableZone.holes) {
          if (pointInPolygon(position.x, position.y, hole)) {
            inHole = true;
            break;
          }
        }
        
        if (!inHole) {
          return this.zones.get(walkableZone.roomName) || null;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Update player position and detect zone transitions
   */
  updatePlayerPosition(playerId: string, position: Point): ZoneTransitionEvent | null {
    const currentZone = this.playerZones.get(playerId) || null;
    const newZone = this.getZoneAtPosition(position);
    const newZoneName = newZone?.name || null;
    
    // Check if zone changed
    if (currentZone !== newZoneName) {
      this.playerZones.set(playerId, newZoneName);
      
      if (newZoneName !== null && newZone) {
        return {
          playerId,
          fromZone: currentZone,
          toZone: newZoneName,
          zoneType: newZone.type,
          timestamp: Date.now()
        };
      }
    }
    
    return null;
  }
  
  /**
   * Get current zone for a player
   */
  getPlayerZone(playerId: string): Zone | null {
    const zoneName = this.playerZones.get(playerId);
    if (!zoneName) return null;
    return this.zones.get(zoneName) || null;
  }
  
  /**
   * Get all zones of a specific type
   */
  getZonesByType(type: ZoneType): Zone[] {
    const zones: Zone[] = [];
    for (const zone of this.zones.values()) {
      if (zone.type === type) {
        zones.push(zone);
      }
    }
    return zones;
  }
  
  /**
   * Get all room zones
   */
  getRooms(): Zone[] {
    return this.getZonesByType(ZoneType.ROOM);
  }
  
  /**
   * Get all hallway zones
   */
  getHallways(): Zone[] {
    return this.getZonesByType(ZoneType.HALLWAY);
  }
  
  /**
   * Get zone by name
   */
  getZone(name: string): Zone | null {
    return this.zones.get(name) || null;
  }
  
  /**
   * Get all zones
   */
  getAllZones(): Zone[] {
    return Array.from(this.zones.values());
  }
  
  /**
   * Calculate centroid of a polygon
   */
  private calculateCentroid(vertices: Point[]): Point {
    let x = 0;
    let y = 0;
    for (const vertex of vertices) {
      x += vertex.x;
      y += vertex.y;
    }
    return {
      x: x / vertices.length,
      y: y / vertices.length
    };
  }
  
  /**
   * Check if position is in a room (vs hallway)
   */
  isInRoom(position: Point): boolean {
    const zone = this.getZoneAtPosition(position);
    return zone?.type === ZoneType.ROOM;
  }
  
  /**
   * Check if position is in a hallway
   */
  isInHallway(position: Point): boolean {
    const zone = this.getZoneAtPosition(position);
    return zone?.type === ZoneType.HALLWAY;
  }
}
