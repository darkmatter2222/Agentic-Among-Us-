/**
 * A* Pathfinding Algorithm
 * Finds optimal paths through the navigation mesh
 */

import type { Point } from '../data/poly3-map.ts';
import type { NavMesh } from './NavMesh.ts';
import { findNearestNode } from './NavMesh.ts';

export interface PathNode {
  position: Point;
  navNodeId: string;
}

export interface PathfindingResult {
  success: boolean;
  path: PathNode[];
  totalCost: number;
}

interface AStarNode {
  navNodeId: string;
  gCost: number; // Cost from start
  hCost: number; // Heuristic cost to end
  fCost: number; // Total cost (g + h)
  parent: string | null;
}

export class Pathfinder {
  private navMesh: NavMesh;
  
  constructor(navMesh: NavMesh) {
    this.navMesh = navMesh;
  }
  
  /**
   * Find a path from start to end position using A* algorithm
   */
  findPath(start: Point, end: Point): PathfindingResult {
    // Find nearest nav nodes to start and end positions
    const startNode = findNearestNode(start, this.navMesh);
    const endNode = findNearestNode(end, this.navMesh);
    
    if (!startNode || !endNode) {
      return {
        success: false,
        path: [],
        totalCost: 0
      };
    }
    
    // If start and end are the same node, return direct path
    if (startNode.id === endNode.id) {
      return {
        success: true,
        path: [
          { position: start, navNodeId: startNode.id },
          { position: end, navNodeId: endNode.id }
        ],
        totalCost: this.calculateDistance(start, end)
      };
    }
    
    // Run A* algorithm
    const nodePath = this.astar(startNode.id, endNode.id);
    
    if (nodePath.length === 0) {
      return {
        success: false,
        path: [],
        totalCost: 0
      };
    }
    
    // Convert node IDs to positions
    const path: PathNode[] = [];
    
    // Add start position
    path.push({ position: start, navNodeId: startNode.id });
    
    // Add intermediate nodes
    for (let i = 1; i < nodePath.length - 1; i++) {
      const node = this.navMesh.nodes.get(nodePath[i])!;
      path.push({
        position: node.position,
        navNodeId: node.id
      });
    }
    
    // Add end position
    path.push({ position: end, navNodeId: endNode.id });
    
    // Calculate total cost
    let totalCost = 0;
    for (let i = 0; i < path.length - 1; i++) {
      totalCost += this.calculateDistance(path[i].position, path[i + 1].position);
    }
    
    return {
      success: true,
      path,
      totalCost
    };
  }
  
  /**
   * A* algorithm implementation
   */
  private astar(startId: string, endId: string): string[] {
    const openSet = new Set<string>([startId]);
    const closedSet = new Set<string>();
    const nodes = new Map<string, AStarNode>();
    
    const endNode = this.navMesh.nodes.get(endId)!;
    
    // Initialize start node
    nodes.set(startId, {
      navNodeId: startId,
      gCost: 0,
      hCost: this.heuristic(startId, endNode.position),
      fCost: this.heuristic(startId, endNode.position),
      parent: null
    });
    
    while (openSet.size > 0) {
      // Find node with lowest fCost
      let currentId = this.getLowestFCostNode(openSet, nodes);
      
      if (currentId === endId) {
        // Path found! Reconstruct it
        return this.reconstructPath(nodes, currentId);
      }
      
      openSet.delete(currentId);
      closedSet.add(currentId);
      
      const current = nodes.get(currentId)!;
      const currentNavNode = this.navMesh.nodes.get(currentId)!;
      
      // Check all neighbors
      for (const edge of currentNavNode.neighbors) {
        const neighborId = edge.targetNodeId;
        
        if (closedSet.has(neighborId) || !edge.walkable) {
          continue;
        }
        
        const tentativeGCost = current.gCost + edge.cost;
        
        if (!openSet.has(neighborId)) {
          // Discover new node
          openSet.add(neighborId);
          nodes.set(neighborId, {
            navNodeId: neighborId,
            gCost: tentativeGCost,
            hCost: this.heuristic(neighborId, endNode.position),
            fCost: tentativeGCost + this.heuristic(neighborId, endNode.position),
            parent: currentId
          });
        } else {
          // Check if this path is better
          const neighborNode = nodes.get(neighborId)!;
          if (tentativeGCost < neighborNode.gCost) {
            neighborNode.gCost = tentativeGCost;
            neighborNode.fCost = tentativeGCost + neighborNode.hCost;
            neighborNode.parent = currentId;
          }
        }
      }
    }
    
    // No path found
    return [];
  }
  
  /**
   * Heuristic function (Euclidean distance)
   */
  private heuristic(nodeId: string, target: Point): number {
    const node = this.navMesh.nodes.get(nodeId)!;
    return this.calculateDistance(node.position, target);
  }
  
  /**
   * Get the node with the lowest fCost from the open set
   */
  private getLowestFCostNode(openSet: Set<string>, nodes: Map<string, AStarNode>): string {
    let lowest: string = '';
    let lowestFCost = Infinity;
    
    for (const nodeId of openSet) {
      const node = nodes.get(nodeId)!;
      if (node.fCost < lowestFCost) {
        lowestFCost = node.fCost;
        lowest = nodeId;
      }
    }
    
    return lowest;
  }
  
  /**
   * Reconstruct path from A* result
   */
  private reconstructPath(nodes: Map<string, AStarNode>, endId: string): string[] {
    const path: string[] = [];
    let currentId: string | null = endId;
    
    while (currentId !== null) {
      path.unshift(currentId);
      const astarNode: AStarNode = nodes.get(currentId)!;
      currentId = astarNode.parent;
    }
    
    return path;
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
   * Update the nav mesh (e.g., when doors close)
   */
  updateNavMesh(navMesh: NavMesh): void {
    this.navMesh = navMesh;
  }
}
