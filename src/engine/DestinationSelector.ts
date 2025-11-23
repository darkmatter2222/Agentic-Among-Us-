/**
 * Destination Selector
 * Intelligently selects random destinations within walkable zones
 */

import type { Point, WalkableZone, Task } from '../data/poly3-map.ts';
import { calculateCentroid, pointInPolygon, isPointWalkable } from '../data/poly3-map.ts';
import type { Zone } from './ZoneDetector.ts';

export interface DestinationOptions {
  preferRooms?: boolean;
  preferHallways?: boolean;
  avoidEdges?: boolean;
  minDistanceFromCurrent?: number;
  maxDistanceFromCurrent?: number;
  targetZone?: string;
}

export class DestinationSelector {
  private walkableZones: WalkableZone[];
  private tasks: Task[];
  private roomCenters: Map<string, Point>;
  
  constructor(walkableZones: WalkableZone[], tasks: Task[] = []) {
    this.walkableZones = walkableZones;
    this.tasks = tasks;
    this.roomCenters = new Map();
    
    // Pre-compute room centers
    for (const zone of walkableZones) {
      this.roomCenters.set(zone.roomName, calculateCentroid(zone.vertices));
    }
  }
  
  /**
   * Select a random destination point
   */
  selectRandomDestination(
    currentPosition: Point,
    zones: Zone[],
    options: DestinationOptions = {}
  ): Point | null {
    // Filter zones based on preferences
    let candidateZones = zones.filter(z => z.isWalkable);
    
    if (options.preferRooms) {
      const rooms = candidateZones.filter(z => z.type === 'ROOM');
      if (rooms.length > 0) candidateZones = rooms;
    }
    
    if (options.preferHallways) {
      const hallways = candidateZones.filter(z => z.type === 'HALLWAY');
      if (hallways.length > 0) candidateZones = hallways;
    }
    
    if (options.targetZone) {
      const targetZone = candidateZones.find(z => z.name === options.targetZone);
      if (targetZone) {
        candidateZones = [targetZone];
      }
    }
    
    if (candidateZones.length === 0) {
      return null;
    }
    
    // Try up to 10 times to find a valid point
    for (let attempt = 0; attempt < 10; attempt++) {
      // Pick a random zone
      const zone = candidateZones[Math.floor(Math.random() * candidateZones.length)];
      
      // Generate a point in this zone
      const point = this.generatePointInZone(zone, options.avoidEdges || false);
      
      if (point) {
        // Check distance constraints
        const distance = this.calculateDistance(currentPosition, point);
        
        if (options.minDistanceFromCurrent && distance < options.minDistanceFromCurrent) {
          continue;
        }
        
        if (options.maxDistanceFromCurrent && distance > options.maxDistanceFromCurrent) {
          continue;
        }
        
        return point;
      }
    }
    
    // Fallback: just return a zone center
    const zone = candidateZones[Math.floor(Math.random() * candidateZones.length)];
    return zone.center;
  }
  
  /**
   * Generate a random point within a zone
   */
  private generatePointInZone(zone: Zone, avoidEdges: boolean): Point | null {
    const vertices = zone.vertices;
    
    // Calculate zone bounds
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (const vertex of vertices) {
      minX = Math.min(minX, vertex.x);
      maxX = Math.max(maxX, vertex.x);
      minY = Math.min(minY, vertex.y);
      maxY = Math.max(maxY, vertex.y);
    }
    
    // Try to generate a point within bounds
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i++) {
      let x: number, y: number;
      
      if (avoidEdges) {
        // Bias toward center
        const centerBias = 0.6;
        x = minX + (maxX - minX) * (Math.random() * (1 - centerBias) + centerBias * 0.5);
        y = minY + (maxY - minY) * (Math.random() * (1 - centerBias) + centerBias * 0.5);
      } else {
        x = minX + Math.random() * (maxX - minX);
        y = minY + Math.random() * (maxY - minY);
      }
      
      // Check if point is in the zone
      if (pointInPolygon(x, y, vertices)) {
        // Check if walkable
        if (isPointWalkable(x, y, this.walkableZones)) {
          return { x, y };
        }
      }
    }
    
    return null;
  }
  
  /**
   * Select a task location as destination
   */
  selectTaskDestination(taskName?: string): Point | null {
    if (this.tasks.length === 0) {
      return null;
    }
    
    if (taskName) {
      const task = this.tasks.find(t => t.type === taskName);
      return task ? task.position : null;
    }
    
    // Random task
    const task = this.tasks[Math.floor(Math.random() * this.tasks.length)];
    return task.position;
  }
  
  /**
   * Select a room center as destination
   */
  selectRoomCenter(roomName?: string): Point | null {
    if (roomName) {
      return this.roomCenters.get(roomName) || null;
    }
    
    // Random room
    const rooms = Array.from(this.roomCenters.entries());
    if (rooms.length === 0) return null;
    
    const [_, center] = rooms[Math.floor(Math.random() * rooms.length)];
    return center;
  }
  
  /**
   * Select a point near another point
   */
  selectNearbyPoint(
    position: Point,
    radius: number
  ): Point | null {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * radius;
    
    const point = {
      x: position.x + Math.cos(angle) * distance,
      y: position.y + Math.sin(angle) * distance
    };
    
    // Check if walkable
    if (isPointWalkable(point.x, point.y, this.walkableZones)) {
      return point;
    }
    
    // Fallback: try a few more times
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * radius;
      const testPoint = {
        x: position.x + Math.cos(angle) * distance,
        y: position.y + Math.sin(angle) * distance
      };
      
      if (isPointWalkable(testPoint.x, testPoint.y, this.walkableZones)) {
        return testPoint;
      }
    }
    
    return null;
  }
  
  /**
   * Calculate distance between two points
   */
  private calculateDistance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  /**
   * Get all available room centers
   */
  getRoomCenters(): Map<string, Point> {
    return new Map(this.roomCenters);
  }
}
