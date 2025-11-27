/**
 * Visibility-Graph Pathfinding
 * Builds a line-of-sight visibility graph from the navigation mesh nodes,
 * then runs A* directly on that dense graph to generate smooth, wall-safe routes.
 */

import type { Point, WalkableZone } from '@shared/data/poly3-map.ts';
import { isPointWalkable } from '@shared/data/poly3-map.ts';
import type { NavMesh } from './NavMesh.ts';

export interface PathNode {
  position: Point;
  navNodeId: string;
}

export interface PathfindingResult {
  success: boolean;
  path: PathNode[];
  totalCost: number;
}

interface GraphNode {
  id: string;
  position: Point;
}

interface GraphEdge {
  targetId: string;
  cost: number;
}

interface AStarNode {
  id: string;
  gCost: number;
  hCost: number;
  fCost: number;
  parent: string | null;
}

export class Pathfinder {
  private navMesh: NavMesh;
  private walkableZones: WalkableZone[];
  private graphNodes: Map<string, GraphNode> = new Map();
  private visibilityEdges: Map<string, GraphEdge[]> = new Map();

  constructor(navMesh: NavMesh, walkableZones: WalkableZone[]) {
    this.navMesh = navMesh;
    this.walkableZones = walkableZones;
    this.rebuildVisibilityGraph();
  }
  
  /**
   * Find a path from start to end position using A* algorithm
   */
  findPath(start: Point, end: Point): PathfindingResult {
    const { nodes, edges, startId, endId, valid } = this.prepareGraphForQuery(start, end);

    if (!valid) {
      return {
        success: false,
        path: [],
        totalCost: 0
      };
    }

    const nodePath = this.astar(nodes, edges, startId, endId);

    if (nodePath.length === 0) {
      return {
        success: false,
        path: [],
        totalCost: 0
      };
    }

    const path: PathNode[] = nodePath.map(nodeId => {
      if (nodeId === startId) {
        return { position: start, navNodeId: startId };
      }
      if (nodeId === endId) {
        return { position: end, navNodeId: endId };
      }
      const node = nodes.get(nodeId)!;
      return {
        position: node.position,
        navNodeId: node.id
      };
    });

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
  
  private astar(
    nodes: Map<string, GraphNode>,
    edges: Map<string, GraphEdge[]>,
    startId: string,
    endId: string
  ): string[] {
    const openSet = new Set<string>([startId]);
    const closedSet = new Set<string>();
    const searchNodes = new Map<string, AStarNode>();

    const endNode = nodes.get(endId)!;

    searchNodes.set(startId, {
      id: startId,
      gCost: 0,
      hCost: this.calculateDistance(nodes.get(startId)!.position, endNode.position),
      fCost: this.calculateDistance(nodes.get(startId)!.position, endNode.position),
      parent: null
    });

    while (openSet.size > 0) {
      const currentId = this.getLowestFCostNode(openSet, searchNodes);

      if (currentId === endId) {
        return this.reconstructPath(searchNodes, currentId);
      }

      openSet.delete(currentId);
      closedSet.add(currentId);

      const currentNode = searchNodes.get(currentId)!;
      const neighborEdges = edges.get(currentId) ?? [];

      for (const edge of neighborEdges) {
        const neighborId = edge.targetId;

        if (closedSet.has(neighborId)) {
          continue;
        }

        const tentativeG = currentNode.gCost + edge.cost;

        if (!openSet.has(neighborId)) {
          openSet.add(neighborId);
          searchNodes.set(neighborId, {
            id: neighborId,
            gCost: tentativeG,
            hCost: this.calculateDistance(nodes.get(neighborId)!.position, endNode.position),
            fCost: tentativeG + this.calculateDistance(nodes.get(neighborId)!.position, endNode.position),
            parent: currentId
          });
        } else {
          const neighborNode = searchNodes.get(neighborId)!;
          if (tentativeG < neighborNode.gCost) {
            neighborNode.gCost = tentativeG;
            neighborNode.fCost = tentativeG + neighborNode.hCost;
            neighborNode.parent = currentId;
          }
        }
      }
    }

    return [];
  }

  private prepareGraphForQuery(start: Point, end: Point) {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge[]>();

    // Copy static nodes and edge lists (deep copy of edges to avoid mutation)
    for (const [id, node] of this.graphNodes.entries()) {
      nodes.set(id, node);
    }

    for (const [id, list] of this.visibilityEdges.entries()) {
      edges.set(id, list.map(edge => ({ ...edge })));
    }

    const startId = '__start__';
    const endId = '__end__';

    nodes.set(startId, { id: startId, position: start });
    nodes.set(endId, { id: endId, position: end });
    edges.set(startId, []);
    edges.set(endId, []);

    this.connectDynamicNode(startId, start, nodes, edges);
    this.connectDynamicNode(endId, end, nodes, edges);

    // Direct connection if possible
    if (this.hasLineOfSight(start, end)) {
      const cost = this.calculateDistance(start, end);
      edges.get(startId)!.push({ targetId: endId, cost });
      edges.get(endId)!.push({ targetId: startId, cost });
    }

    const startConnected = this.ensureNodeHasConnections(startId, edges);
    const endConnected = this.ensureNodeHasConnections(endId, edges);

    return {
      nodes,
      edges,
      startId,
      endId,
      valid: startConnected && endConnected
    };
  }

  private connectDynamicNode(
    nodeId: string,
    position: Point,
    nodes: Map<string, GraphNode>,
    edges: Map<string, GraphEdge[]>
  ): void {
    for (const [otherId, otherNode] of this.graphNodes.entries()) {
      if (otherId === nodeId) continue;
      if (!nodes.has(otherId)) continue;

      if (this.hasLineOfSight(position, otherNode.position)) {
        const cost = this.calculateDistance(position, otherNode.position);
        edges.get(nodeId)!.push({ targetId: otherId, cost });

        const existing = edges.get(otherId);
        if (existing) {
          existing.push({ targetId: nodeId, cost });
        } else {
          edges.set(otherId, [{ targetId: nodeId, cost }]);
        }
      }
    }
  }

  private ensureNodeHasConnections(
    nodeId: string,
    edges: Map<string, GraphEdge[]>
  ): boolean {
    const connections = edges.get(nodeId) ?? [];
    if (connections.length > 0) {
      return true;
    }

    // No viable connection found – fail early so we can report no path.
    return false;
  }

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

  private rebuildVisibilityGraph(): void {
    this.graphNodes = new Map();
    this.visibilityEdges = new Map();

    for (const [id, node] of this.navMesh.nodes.entries()) {
      this.graphNodes.set(id, { id, position: { ...node.position } });
    }

    const nodeEntries = Array.from(this.graphNodes.values());
    const count = nodeEntries.length;

    // Initialize edge map
    for (const node of nodeEntries) {
      this.visibilityEdges.set(node.id, []);
    }

    for (let i = 0; i < count; i++) {
      const nodeA = nodeEntries[i];
      for (let j = i + 1; j < count; j++) {
        const nodeB = nodeEntries[j];
        if (this.hasLineOfSight(nodeA.position, nodeB.position)) {
          const cost = this.calculateDistance(nodeA.position, nodeB.position);
          this.visibilityEdges.get(nodeA.id)!.push({ targetId: nodeB.id, cost });
          this.visibilityEdges.get(nodeB.id)!.push({ targetId: nodeA.id, cost });
        }
      }
    }
  }

  private hasLineOfSight(a: Point, b: Point): boolean {
    const distance = this.calculateDistance(a, b);
    const steps = Math.max(1, Math.ceil(distance / 8));

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const sample = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t
      };

      if (!isPointWalkable(sample.x, sample.y, this.walkableZones)) {
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
   * Update the nav mesh (e.g., when doors close)
   */
  updateNavMesh(navMesh: NavMesh): void {
    this.navMesh = navMesh;
    this.rebuildVisibilityGraph();
  }
}
