import math
from typing import List, Tuple
from game.state import PlayerState
from game.map_layouts import SpaceshipMap

class VisionSystem:
    @staticmethod
    def cast_vision_rays(player: PlayerState, game_map: SpaceshipMap) -> List[Tuple[float, float]]:
        vision_radius = 10.0 # Game units
        fov_angle = math.radians(90)
        start_angle = player.facing_angle - fov_angle / 2
        
        points = []
        # Player center in world coords
        px, py = player.position.x, player.position.y
        points.append((px, py))
        
        # OPTIMIZATION: Reduced ray count from 30 to 15 for performance
        num_rays = 15
        step_size = 1.0 # Increased from 0.5 to 1.0 for faster raycasting
        
        for i in range(num_rays + 1):
            angle = start_angle + (fov_angle * i / num_rays)
            dx = math.cos(angle)
            dy = math.sin(angle)
            
            hit_x, hit_y = px + dx * vision_radius, py + dy * vision_radius
            
            # Raymarch
            dist = 0.0
            while dist < vision_radius:
                dist += step_size
                check_x = px + dx * dist
                check_y = py + dy * dist
                
                # Check bounds
                if not (0 <= check_x < game_map.width and 0 <= check_y < game_map.height):
                    hit_x, hit_y = check_x, check_y
                    break
                
                # Check wall (1 in grid)
                if game_map.grid[int(check_y)][int(check_x)] == 1:
                    hit_x, hit_y = check_x, check_y
                    break
            
            points.append((hit_x, hit_y))
            
        return points

    @staticmethod
    def is_visible(observer: PlayerState, target: PlayerState, game_map: SpaceshipMap) -> bool:
        """Check if target is visible to observer."""
        if not target.is_alive:
            # Dead bodies are visible if within range and LOS
            pass # Logic is same for now
            
        dist = observer.position.distance_to(target.position)
        if dist > 10.0: # Vision radius
            return False
            
        # Check angle (FOV)
        dx = target.position.x - observer.position.x
        dy = target.position.y - observer.position.y
        angle_to_target = math.atan2(dy, dx)
        
        # Normalize angles
        diff = angle_to_target - observer.facing_angle
        while diff > math.pi: diff -= 2*math.pi
        while diff < -math.pi: diff += 2*math.pi
        
        if abs(diff) > math.radians(45): # 90 degree FOV / 2
            return False
            
        # Raycast to check walls
        step_size = 0.5
        steps = int(dist / step_size)
        for i in range(1, steps):
            t = i / steps
            cx = observer.position.x + dx * t
            cy = observer.position.y + dy * t
            if game_map.grid[int(cy)][int(cx)] == 1:
                return False
                
        return True
