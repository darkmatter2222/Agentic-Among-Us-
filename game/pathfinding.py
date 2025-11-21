import heapq
import math
from typing import List, Tuple, Optional, Dict
from game.map_layouts import SpaceshipMap, Point

class Node:
    def __init__(self, x: int, y: int):
        self.x = x
        self.y = y
        self.g = 0.0
        self.h = 0.0
        self.parent: Optional['Node'] = None

    @property
    def f(self):
        return self.g + self.h

    def __lt__(self, other):
        return self.f < other.f
    
    def __eq__(self, other):
        return self.x == other.x and self.y == other.y
    
    def __hash__(self):
        return hash((self.x, self.y))

class Pathfinder:
    def __init__(self, game_map: SpaceshipMap):
        self.game_map = game_map
        self.width = game_map.width
        self.height = game_map.height

    def get_neighbors(self, node: Node) -> List[Node]:
        neighbors = []
        # 8 directions
        directions = [
            (0, 1), (0, -1), (1, 0), (-1, 0), # Cardinal
            (1, 1), (1, -1), (-1, 1), (-1, -1) # Diagonal
        ]
        
        for dx, dy in directions:
            nx, ny = node.x + dx, node.y + dy
            
            if 0 <= nx < self.width and 0 <= ny < self.height:
                if self.game_map.is_walkable(nx, ny):
                    # Check diagonal movement (don't cut corners through walls)
                    if abs(dx) == 1 and abs(dy) == 1:
                        if not self.game_map.is_walkable(node.x + dx, node.y) or \
                           not self.game_map.is_walkable(node.x, node.y + dy):
                            continue
                            
                    neighbors.append(Node(nx, ny))
                    
        return neighbors

    def heuristic(self, a: Node, b: Node) -> float:
        # Euclidean distance is better for "natural" movement than Manhattan
        return math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2)

    def find_path(self, start: Tuple[int, int], end: Tuple[int, int]) -> List[Tuple[int, int]]:
        start_node = Node(start[0], start[1])
        end_node = Node(end[0], end[1])
        
        if not self.game_map.is_walkable(end[0], end[1]):
            # Find nearest walkable neighbor to end
            # Simple search
            found = False
            for r in range(1, 5):
                for dy in range(-r, r+1):
                    for dx in range(-r, r+1):
                        nx, ny = end[0] + dx, end[1] + dy
                        if self.game_map.is_walkable(nx, ny):
                            end_node = Node(nx, ny)
                            found = True
                            break
                    if found: break
                if found: break
            if not found:
                return []

        open_list = []
        closed_set = set()
        
        heapq.heappush(open_list, start_node)
        
        # Keep track of nodes we've seen to update g-costs
        node_cache: Dict[Tuple[int, int], Node] = {}
        node_cache[(start_node.x, start_node.y)] = start_node

        while open_list:
            current_node = heapq.heappop(open_list)
            
            if current_node == end_node:
                path = []
                curr = current_node
                while curr:
                    path.append((curr.x, curr.y))
                    curr = curr.parent
                return path[::-1] # Return reversed path
            
            closed_set.add((current_node.x, current_node.y))
            
            for neighbor in self.get_neighbors(current_node):
                if (neighbor.x, neighbor.y) in closed_set:
                    continue
                
                # Cost is 1 for cardinal, 1.414 for diagonal
                move_cost = 1.0 if (neighbor.x == current_node.x or neighbor.y == current_node.y) else 1.414
                new_g = current_node.g + move_cost
                
                cached_neighbor = node_cache.get((neighbor.x, neighbor.y))
                
                if not cached_neighbor or new_g < cached_neighbor.g:
                    neighbor.g = new_g
                    neighbor.h = self.heuristic(neighbor, end_node)
                    neighbor.parent = current_node
                    node_cache[(neighbor.x, neighbor.y)] = neighbor
                    heapq.heappush(open_list, neighbor)
                    
        return [] # No path found

    def smooth_path(self, path: List[Tuple[int, int]]) -> List[Tuple[float, float]]:
        """
        Simple path smoothing using Catmull-Rom splines or just corner cutting.
        For now, let's convert to float points and maybe add intermediate points for curves.
        """
        if len(path) < 3:
            return [(float(x), float(y)) for x, y in path]
            
        # Catmull-Rom Spline implementation
        smoothed_path = []
        
        # Duplicate start and end points to make the spline go through them
        points = [path[0]] + path + [path[-1]]
        
        steps_per_segment = 5
        
        for i in range(len(points) - 3):
            p0 = points[i]
            p1 = points[i+1]
            p2 = points[i+2]
            p3 = points[i+3]
            
            for t_step in range(steps_per_segment):
                t = t_step / steps_per_segment
                
                # Catmull-Rom formula
                # q(t) = 0.5 * ((2*P1) + (-P0 + P2) * t + (2*P0 - 5*P1 + 4*P2 - P3) * t^2 + (-P0 + 3*P1 - 3*P2 + P3) * t^3)
                
                tt = t * t
                ttt = tt * t
                
                x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * tt + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * ttt)
                y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * tt + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * ttt)
                
                smoothed_path.append((x, y))
                
        smoothed_path.append((float(path[-1][0]), float(path[-1][1])))
        return smoothed_path
