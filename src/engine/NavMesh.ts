/**
 * Navigation Mesh System for Among Us
 * Converts walkable polygons into a navigation graph for pathfinding
 */

import type { Point, WalkableZone } from '@shared/data/poly3-map.ts';
import { calculateCentroid, pointInPolygon } from '@shared/data/poly3-map.ts';

export interface NavNode {
  id: string;
  position: Point;
  zone: string; // Room or hallway name
  isRoom: boolean;
  neighbors: NavEdge[];
}

export interface NavEdge {
  targetNodeId: string;
  cost: number; // Distance or weight
  walkable: boolean; // Can be blocked by doors
}

export interface NavMesh {
  nodes: Map<string, NavNode>;
  zones: Map<string, string[]>; // zone name -> node IDs
}

export class NavMeshBuilder {
  private nodeIdCounter = 0;
  
  /**
   * Build a navigation mesh from walkable zones
   */
  buildFromWalkableZones(walkableZones: WalkableZone[]): NavMesh {
    const nodes = new Map<string, NavNode>();
    const zones = new Map<string, string[]>();
    
    // Step 1: Create nodes for each zone
    walkableZones.forEach(zone => {
      const zoneNodes = this.createNodesForZone(zone);
      zoneNodes.forEach(node => {
        nodes.set(node.id, node);
      });
      
      // Track nodes by zone
      const nodeIds = zoneNodes.map(n => n.id);
      zones.set(zone.roomName, nodeIds);
    });
    
    // Step 2: Connect nodes within each zone
    walkableZones.forEach(zone => {
      const zoneNodeIds = zones.get(zone.roomName) || [];
      this.connectNodesInZone(nodes, zoneNodeIds, zone);
    });
    
    // Step 3: Connect nodes between adjacent zones
    this.connectAdjacentZones(nodes, zones);
    
    return { nodes, zones };
  }
  
  /**
   * Create navigation nodes for a single walkable zone
   */
  private createNodesForZone(zone: WalkableZone): NavNode[] {
    const nodes: NavNode[] = [];
    
    // Always add zone centroid as a primary node
    const centroid = calculateCentroid(zone.vertices);
    nodes.push({
      id: this.generateNodeId(),
      position: centroid,
      zone: zone.roomName,
      isRoom: zone.isRoom,
      neighbors: []
    });
    
    // Add nodes at key points (vertices, midpoints)
    // This creates a denser navigation mesh for better pathfinding
    for (let i = 0; i < zone.vertices.length; i++) {
      const v1 = zone.vertices[i];
      const v2 = zone.vertices[(i + 1) % zone.vertices.length];
      
      // Add midpoint between vertices
      const midpoint = {
        x: (v1.x + v2.x) / 2,
        y: (v1.y + v2.y) / 2
      };
      
      // Move midpoint slightly inward (10% toward centroid)
      const inwardPoint = {
        x: midpoint.x + (centroid.x - midpoint.x) * 0.1,
        y: midpoint.y + (centroid.y - midpoint.y) * 0.1
      };
      
      // Only add if still in walkable area
      if (this.isPointInZone(inwardPoint, zone)) {
        nodes.push({
          id: this.generateNodeId(),
          position: inwardPoint,
          zone: zone.roomName,
          isRoom: zone.isRoom,
          neighbors: []
        });
      }
    }
    
    return nodes;
  }
  
  /**
   * Connect nodes within the same zone
   */
  private connectNodesInZone(
    allNodes: Map<string, NavNode>,
    nodeIds: string[],
    zone: WalkableZone
  ): void {
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const node1 = allNodes.get(nodeIds[i])!;
        const node2 = allNodes.get(nodeIds[j])!;
        
        // Check if path between nodes is clear
        if (this.isPathClear(node1.position, node2.position, zone)) {
          const distance = this.calculateDistance(node1.position, node2.position);
          
          // Add bidirectional edge
          node1.neighbors.push({
            targetNodeId: node2.id,
            cost: distance,
            walkable: true
          });
          
          node2.neighbors.push({
            targetNodeId: node1.id,
            cost: distance,
            walkable: true
          });
        }
      }
    }
  }
  
  /**
   * Connect nodes between adjacent zones (for transitioning between rooms/hallways)
   */
  private connectAdjacentZones(
    nodes: Map<string, NavNode>,
    zones: Map<string, string[]>
  ): void {
    const zoneArray = Array.from(zones.entries());
    
    for (let i = 0; i < zoneArray.length; i++) {
      for (let j = i + 1; j < zoneArray.length; j++) {
        const [, nodeIds1] = zoneArray[i];
        const [, nodeIds2] = zoneArray[j];
        
        // Find closest nodes between zones
        let minDistance = Infinity;
        let closestPair: [string, string] | null = null;
        
        for (const id1 of nodeIds1) {
          for (const id2 of nodeIds2) {
            const node1 = nodes.get(id1)!;
            const node2 = nodes.get(id2)!;
            const distance = this.calculateDistance(node1.position, node2.position);
            
            if (distance < minDistance && distance < 200) { // Max connection distance
              minDistance = distance;
              closestPair = [id1, id2];
            }
          }
        }
        
        // Connect the closest pair if they're reasonably close
        if (closestPair) {
          const node1 = nodes.get(closestPair[0])!;
          const node2 = nodes.get(closestPair[1])!;
          
          node1.neighbors.push({
            targetNodeId: node2.id,
            cost: minDistance,
            walkable: true
          });
          
          node2.neighbors.push({
            targetNodeId: node1.id,
            cost: minDistance,
            walkable: true
          });
        }
      }
    }
  }
  
  /**
   * Check if a straight line path is clear within a zone
   */
  private isPathClear(from: Point, to: Point, zone: WalkableZone): boolean {
    // Sample points along the path
    const samples = 10;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const point = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t
      };
      
      if (!this.isPointInZone(point, zone)) {
        return false;
      }
    }
    return true;
  }
  
  /**
   * Check if a point is in a walkable zone (and not in any holes)
   */
  private isPointInZone(point: Point, zone: WalkableZone): boolean {
    if (!pointInPolygon(point.x, point.y, zone.vertices)) {
      return false;
    }
    
    // Check if in any holes
    for (const hole of zone.holes) {
      if (pointInPolygon(point.x, point.y, hole)) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Calculate Euclidean distance between two points
   */
  private calculateDistance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  /**
   * Generate unique node ID
   */
  private generateNodeId(): string {
    return `nav_node_${this.nodeIdCounter++}`;
  }
}

/**
 * Find the nearest navigation node to a given position
 */
export function findNearestNode(
  position: Point,
  navMesh: NavMesh,
  maxDistance: number = Infinity
): NavNode | null {
  let nearest: NavNode | null = null;
  let minDistance = maxDistance;
  
  for (const node of navMesh.nodes.values()) {
    const dx = position.x - node.position.x;
    const dy = position.y - node.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance < minDistance) {
      minDistance = distance;
      nearest = node;
    }
  }
  
  return nearest;
}
