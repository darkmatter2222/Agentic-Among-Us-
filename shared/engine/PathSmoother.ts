/**
 * Path Smoothing System
 * Converts linear waypoint paths into smooth, curved paths using Catmull-Rom splines
 */

import type { Point } from '../data/poly3-map.ts';
import { isPointWalkable, WALKABLE_ZONES, OBSTACLES } from '../data/poly3-map.ts';
import type { PathNode } from './Pathfinder.ts';

export interface SmoothPath {
  points: Point[];
  totalLength: number;
}

export class PathSmoother {
  private smoothness: number; // Points per segment (higher = smoother)
  
  constructor(smoothness: number = 20) {
    this.smoothness = smoothness;
  }
  
  /**
   * Smooth a path using String Pulling and Catmull-Rom splines
   */
  smoothPath(waypoints: PathNode[]): SmoothPath {
    if (waypoints.length < 2) {
      return {
        points: waypoints.map(w => w.position),
        totalLength: 0
      };
    }

    // Step 1: String Pulling (Line-of-Sight Optimization)
    // This removes unnecessary zig-zags from the A* path
    const simplifiedPoints = this.simplifyPath(waypoints.map(w => w.position));
    
    if (simplifiedPoints.length === 2) {
      // Just two points, return linear interpolation
      const points = this.linearInterpolate(
        simplifiedPoints[0],
        simplifiedPoints[1],
        this.smoothness
      );
      return {
        points,
        totalLength: this.calculateDistance(simplifiedPoints[0], simplifiedPoints[1])
      };
    }
    
    // Extract positions
    const positions = simplifiedPoints;
    
    // Apply Catmull-Rom spline with wall collision validation
    const smoothPoints: Point[] = [];
    
    for (let i = 0; i < positions.length - 1; i++) {
      // Get four control points for the spline
      const p0 = positions[Math.max(0, i - 1)];
      const p1 = positions[i];
      const p2 = positions[i + 1];
      const p3 = positions[Math.min(positions.length - 1, i + 2)];
      
      // Generate smooth points between p1 and p2
      const segmentPoints: Point[] = [];
      let invalidCount = 0;
      const tolerance = Math.ceil(this.smoothness * 0.1); // Allow 10% invalid points
      
      for (let t = 0; t < 1; t += 1 / this.smoothness) {
        const point = this.catmullRomPoint(p0, p1, p2, p3, t);

        // WALL VALIDATION: Check if this curved point is walkable
        if (!isPointWalkable(point.x, point.y, WALKABLE_ZONES, OBSTACLES)) {
          invalidCount++;
          // If too many invalid points, this curve cuts through walls
          if (invalidCount > tolerance) {
            break;
          }
        } else {
          segmentPoints.push(point);
        }
      }
      
      // If curve significantly hits walls, fall back to linear interpolation
      const hasInvalidPoint = invalidCount > tolerance;
      
      // If curve hits a wall, fall back to linear interpolation
      if (hasInvalidPoint) {
        // console.log(`[PathSmoother] Curve segment ${i} hits wall, using linear path`);
        const linearPoints = this.linearInterpolate(p1, p2, this.smoothness);
        smoothPoints.push(...linearPoints);
      } else {
        smoothPoints.push(...segmentPoints);
      }
    }
    
    // Add final point (already validated by pathfinding)
    smoothPoints.push(positions[positions.length - 1]);
    
    // Calculate total length
    let totalLength = 0;
    for (let i = 0; i < smoothPoints.length - 1; i++) {
      totalLength += this.calculateDistance(smoothPoints[i], smoothPoints[i + 1]);
    }
    
    return {
      points: smoothPoints,
      totalLength
    };
  }

  /**
   * Simplifies path by removing nodes that can be skipped (String Pulling)
   */
  private simplifyPath(points: Point[]): Point[] {
    if (points.length <= 2) return points;

    const simplified: Point[] = [points[0]];
    let currentIdx = 0;

    while (currentIdx < points.length - 1) {
      // Try to connect to the furthest possible node
      let nextIdx = currentIdx + 1;
      
      for (let i = points.length - 1; i > currentIdx + 1; i--) {
        if (this.hasLineOfSight(points[currentIdx], points[i])) {
          nextIdx = i;
          break;
        }
      }

      simplified.push(points[nextIdx]);
      currentIdx = nextIdx;
    }

    return simplified;
  }

  /**
   * Checks if there is a clear line of sight between two points
   */
  private hasLineOfSight(start: Point, end: Point): boolean {
    const dist = this.calculateDistance(start, end);
    const steps = Math.ceil(dist / 5); // Check every 5 units (approx player size)
    
    if (steps === 0) return true;

    const dx = (end.x - start.x) / steps;
    const dy = (end.y - start.y) / steps;

    for (let i = 1; i < steps; i++) {
      const checkX = start.x + dx * i;
      const checkY = start.y + dy * i;

      if (!isPointWalkable(checkX, checkY, WALKABLE_ZONES, OBSTACLES)) {
        return false;
      }
    }

    return true;
  }  /**
   * Catmull-Rom spline interpolation
   * Creates smooth curves passing through all control points
   */
  private catmullRomPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
    const t2 = t * t;
    const t3 = t2 * t;
    
    // Catmull-Rom basis functions
    const x = 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    );
    
    const y = 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );
    
    return { x, y };
  }
  
  /**
   * Linear interpolation between two points
   */
  private linearInterpolate(p1: Point, p2: Point, segments: number): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      points.push({
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t
      });
    }
    return points;
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
   * Set smoothness level
   */
  setSmoothness(smoothness: number): void {
    this.smoothness = smoothness;
  }
}

/**
 * Add subtle random variation to a path to make it look more natural
 */
export function addPathVariation(points: Point[], variation: number = 5): Point[] {
  return points.map((point, index) => {
    // Don't modify first and last points
    if (index === 0 || index === points.length - 1) {
      return point;
    }
    
    // Add small random offset
    const offsetX = (Math.random() - 0.5) * variation;
    const offsetY = (Math.random() - 0.5) * variation;
    
    return {
      x: point.x + offsetX,
      y: point.y + offsetY
    };
  });
}
