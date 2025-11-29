// Auto-generated from maps/pngs/poly 3.json
// This file contains the accurate vector map data for The Skeld

export interface Point {
  x: number;
  y: number;
}

export interface WalkableZone {
  vertices: Point[];
  isRoom: boolean;
  roomName: string;
  holes: Point[][];
}

export interface LabeledZone {
  vertices: Point[];
  name: string;
}

export interface Vent {
  id: string;
  position: Point;
  connectedTo: string[];
  room?: string; // Optional: room the vent is in (can be derived from position if not present)
}

export interface Door {
  position: Point;
  orientation: string;
  room: string;
}

export interface Task {
  type: string;
  position: Point;
  room: string;
}

export interface Obstacle {
  id: string;
  type: string;  // 'table', 'chair', 'console', 'bed'
  position: Point;
  width: number;
  height: number;
}

export interface EmergencyButton {
  position: Point;
  room: string;
}

export interface MapMetadata {
  image: string;
  version: string;
}

export interface MapData {
  metadata: MapMetadata;
  walls: never[];
  walkableZones: WalkableZone[];
  labeledZones: LabeledZone[];
  vents: Vent[];
  doors: Door[];
  tasks: Task[];
  cameras: never[];
  obstacles: Obstacle[];
  emergencyButton: EmergencyButton | null;
}

// Import the JSON data
import poly3Data from '../../maps/pngs/poly 3.json';

export const POLY3_MAP_DATA: MapData = poly3Data as MapData;

// Helper function to calculate polygon centroid
export function calculateCentroid(vertices: Point[]): Point {
  let x = 0;
  let y = 0;
  const n = vertices.length;
  
  for (const vertex of vertices) {
    x += vertex.x;
    y += vertex.y;
  }
  
  return {
    x: x / n,
    y: y / n
  };
}

// Helper function to check if point is inside polygon (for movement validation)
export function pointInPolygon(x: number, y: number, vertices: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;
    
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Helper function to check if a point is inside a rectangular obstacle
export function isPointInObstacle(x: number, y: number, obstacle: Obstacle): boolean {
  const halfWidth = obstacle.width / 2;
  const halfHeight = obstacle.height / 2;
  return (
    x >= obstacle.position.x - halfWidth &&
    x <= obstacle.position.x + halfWidth &&
    y >= obstacle.position.y - halfHeight &&
    y <= obstacle.position.y + halfHeight
  );
}

// Helper function to check if a point is in a walkable area
export function isPointWalkable(
  x: number,
  y: number,
  walkableZones: WalkableZone[],
  obstacles: Obstacle[] = []
): boolean {
  // First check if point is inside any obstacle (tables, chairs, etc.)
  for (const obstacle of obstacles) {
    if (isPointInObstacle(x, y, obstacle)) {
      return false; // Inside an obstacle
    }
  }

  for (const zone of walkableZones) {
    // Check if point is inside the zone boundary
    if (pointInPolygon(x, y, zone.vertices)) {
      // Check if point is NOT inside any hole
      for (const hole of zone.holes) {
        if (pointInPolygon(x, y, hole)) {
          return false; // Inside a hole (obstacle)
        }
      }
      return true; // Inside walkable zone and not in any hole
    }
  }
  return false; // Not in any walkable zone
}

// Helper function to get the current labeled zone name
export function getCurrentZone(x: number, y: number, labeledZones: LabeledZone[]): string | null {
  for (const zone of labeledZones) {
    if (pointInPolygon(x, y, zone.vertices)) {
      return zone.name;
    }
  }
  // Not in a declared zone - player is in a hallway
  return 'Hallway';
}

// Export commonly used map elements
export const MAP_METADATA = POLY3_MAP_DATA.metadata;
export const WALKABLE_ZONES = POLY3_MAP_DATA.walkableZones;
export const LABELED_ZONES = POLY3_MAP_DATA.labeledZones;
export const VENTS = POLY3_MAP_DATA.vents;
export const DOORS = POLY3_MAP_DATA.doors;
export const TASKS = POLY3_MAP_DATA.tasks;
export const OBSTACLES = POLY3_MAP_DATA.obstacles || [];
export const EMERGENCY_BUTTON = POLY3_MAP_DATA.emergencyButton;
