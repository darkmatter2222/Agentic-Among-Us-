/**
 * Path Smoothing System
 * Converts linear waypoint paths into smooth, natural paths using String Pulling
 */

import type { Point } from '../data/poly3-map.ts';
import type { NavMesh } from './NavMesh.ts';
import type { PathNode } from './Pathfinder.ts';

export interface SmoothPath {
  path: PathNode[];
  totalLength: number;
}

interface LineSegment {
  p1: Point;
  p2: Point;
}

export class PathSmoother {
  private navMesh: NavMesh;
  private wallEdges: LineSegment[] = [];
  
  constructor(navMesh: NavMesh) {
    this.navMesh = navMesh;
    this.identifyWallEdges();
  }
  
  /**
   * Pre-calculate wall edges (zone boundaries that are not portals)
   */
  private identifyWallEdges() {
    this.wallEdges = [];
    
    // Collect all portals for easy lookup
    // A portal is defined by two points. Order doesn't matter.
    const portalSegments: LineSegment[] = [];
    for (const portal of this.navMesh.portals.values()) {
      portalSegments.push({ p1: portal.left, p2: portal.right });
    }
    
    // Iterate through all zones
    for (const zone of this.navMesh.zones) {
      const vertices = zone.vertices;
      for (let i = 0; i < vertices.length; i++) {
        const p1 = vertices[i];
        const p2 = vertices[(i + 1) % vertices.length];
        
        // Check if this edge is a portal
        let isPortal = false;
        for (const portal of portalSegments) {
          if (this.areSegmentsEqual({p1, p2}, portal)) {
            isPortal = true;
            break;
          }
        }
        
        if (!isPortal) {
          this.wallEdges.push({ p1, p2 });
        }
      }
    }
    // console.log(`[PathSmoother] Identified ${this.wallEdges.length} wall edges`);
  }
  
  private areSegmentsEqual(s1: LineSegment, s2: LineSegment): boolean {
    const tolerance = 25.0; // 5 pixel distance squared (5^2 = 25)
    
    const dist1 = this.distSq(s1.p1, s2.p1) + this.distSq(s1.p2, s2.p2);
    const dist2 = this.distSq(s1.p1, s2.p2) + this.distSq(s1.p2, s2.p1);
    
    return dist1 < tolerance || dist2 < tolerance;
  }
  
  private distSq(p1: Point, p2: Point): number {
    return (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
  }
  
  /**
   * Smooth a path using String Pulling (Line of Sight)
   */
  smoothPath(waypoints: PathNode[]): SmoothPath {
    if (waypoints.length < 3) {
      return {
        path: waypoints,
        totalLength: this.calculateTotalLength(waypoints)
      };
    }
    
    const smoothed: PathNode[] = [];
    smoothed.push(waypoints[0]); // Always keep start
    
    let currentIdx = 0;
    
    while (currentIdx < waypoints.length - 1) {
      // Look ahead as far as possible
      let furthestVisibleIdx = currentIdx + 1;
      
      for (let i = currentIdx + 2; i < waypoints.length; i++) {
        if (this.hasLineOfSight(waypoints[currentIdx].position, waypoints[i].position)) {
          furthestVisibleIdx = i;
        } else {
          // Optimization: If we can't see i, we probably can't see i+1 (not always true in complex shapes, but good heuristic)
          // For strict string pulling, we should check all, but usually we stop at the first blockage if we are iterating backwards.
          // Let's iterate backwards from end to current+1 to find the furthest visible.
        }
      }
      
      // Re-implementing "Furthest Visible" correctly:
      // Iterate backwards from the end
      let found = false;
      for (let i = waypoints.length - 1; i > currentIdx; i--) {
        if (this.hasLineOfSight(waypoints[currentIdx].position, waypoints[i].position)) {
          smoothed.push(waypoints[i]);
          currentIdx = i;
          found = true;
          break;
        }
      }
      
      if (!found) {
        // Should not happen if adjacent nodes are always visible (which they should be in a valid path)
        // Fallback: just go to next node
        currentIdx++;
        smoothed.push(waypoints[currentIdx]);
      }
    }
    
    return {
      path: smoothed,
      totalLength: this.calculateTotalLength(smoothed)
    };
  }
  
  private hasLineOfSight(start: Point, end: Point): boolean {
    // Check intersection with all wall edges
    for (const wall of this.wallEdges) {
      if (this.segmentsIntersect(start, end, wall.p1, wall.p2)) {
        return false;
      }
    }
    return true;
  }
  
  // Standard line segment intersection
  private segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
    const denominator = ((b.x - a.x) * (d.y - c.y)) - ((b.y - a.y) * (d.x - c.x));
    
    if (denominator === 0) return false; // Parallel
    
    const numerator1 = ((a.y - c.y) * (d.x - c.x)) - ((a.x - c.x) * (d.y - c.y));
    const numerator2 = ((a.y - c.y) * (b.x - a.x)) - ((a.x - c.x) * (b.y - a.y));
    
    const r = numerator1 / denominator;
    const s = numerator2 / denominator;
    
    // Check if intersection is strictly within the segments
    // We use a small epsilon to allow touching endpoints (like corners)
    const epsilon = 0.001;
    return (r > epsilon && r < 1 - epsilon) && (s > epsilon && s < 1 - epsilon);
  }
  
  private calculateTotalLength(path: PathNode[]): number {
    let len = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const dx = path[i+1].position.x - path[i].position.x;
      const dy = path[i+1].position.y - path[i].position.y;
      len += Math.sqrt(dx*dx + dy*dy);
    }
    return len;
  }
}
