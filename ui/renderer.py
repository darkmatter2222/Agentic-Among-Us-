import pygame
import ctypes
import math
from game.state import GameState, PlayerState
from game.map_layouts import SpaceshipMap, Point

# Fix for High DPI displays on Windows
try:
    ctypes.windll.user32.SetProcessDPIAware()
except AttributeError:
    pass

class GameRenderer:
    def __init__(self, width: int, height: int):
        pygame.init()
        self.width = width
        self.height = height
        self.screen = pygame.display.set_mode((width, height), pygame.RESIZABLE)
        pygame.display.set_caption("Agentic Among Us")
        self.font = pygame.font.SysFont("Arial", 12)
        self.room_font = pygame.font.SysFont("Arial", 20, bold=True)
        self.large_font = pygame.font.SysFont("Arial", 24)
        self.sidebar_font = pygame.font.SysFont("Consolas", 14)
        
        # Camera / Scaling
        self.cell_size = 10 # Base cell size
        self.offset_x = 0
        self.offset_y = 0
        self.sidebar_width = 300
        
        # Cache for gradient
        self.gradient_cache = {} # radius -> surface
        
    def handle_events(self) -> bool:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return False
            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    return False
            if event.type == pygame.VIDEORESIZE:
                self.width = event.w
                self.height = event.h
                self.screen = pygame.display.set_mode((self.width, self.height), pygame.RESIZABLE)
        return True

    def _update_camera(self, game_map: SpaceshipMap):
        # Calculate scale to fit map in screen while maintaining aspect ratio
        # Reserve space for sidebar
        available_width = self.width - self.sidebar_width
        if available_width < 100: available_width = 100 # Safety
        
        map_w_px = game_map.width
        map_h_px = game_map.height
        
        scale_x = available_width / map_w_px
        scale_y = self.height / map_h_px
        
        # Use the smaller scale to fit everything
        self.cell_size = min(scale_x, scale_y) * 0.95 # 95% to leave a small margin
        
        # Center the map in the available area
        content_w = map_w_px * self.cell_size
        content_h = map_h_px * self.cell_size
        
        self.offset_x = (available_width - content_w) / 2
        self.offset_y = (self.height - content_h) / 2

    def render(self, game_state: GameState):
        self._update_camera(game_state.map)
        
        self.screen.fill((0, 0, 0)) # Black background (Space)
        
        # Draw Walls (Hull)
        self._draw_walls(game_state.map)

        # Draw Map
        self._draw_map(game_state.map)
        
        # Draw Players
        self._draw_players(game_state)
        
        # Draw UI Overlay
        self._draw_ui(game_state)
        
        # Draw Sidebar
        self._draw_sidebar(game_state)
        
        pygame.display.flip()
        
    def _world_to_screen(self, x: float, y: float) -> tuple[int, int]:
        screen_x = int(x * self.cell_size + self.offset_x)
        screen_y = int(y * self.cell_size + self.offset_y)
        return screen_x, screen_y

    def _draw_walls(self, game_map: SpaceshipMap):
        wall_color = (100, 100, 120) # Blue-ish Gray for Hull
        
        # Optimization: Only check cells that are walls (1) and have a walkable neighbor (0)
        # For a 100x80 grid, iterating all is fine (8000 checks is nothing for 60fps)
        
        for y in range(game_map.height):
            for x in range(game_map.width):
                if game_map.grid[y][x] == 1: # Wall candidate
                    # Check neighbors
                    is_border = False
                    for dy, dx in [(-1,0), (1,0), (0,-1), (0,1), (-1,-1), (-1,1), (1,-1), (1,1)]:
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < game_map.height and 0 <= nx < game_map.width:
                            if game_map.grid[ny][nx] == 0:
                                is_border = True
                                break
                    
                    if is_border:
                        sx, sy = self._world_to_screen(x, y)
                        pygame.draw.rect(self.screen, wall_color, (sx, sy, self.cell_size, self.cell_size))

    def _draw_text_with_outline(self, text, font, color, pos, outline_color=(0,0,0)):
        text_surface = font.render(text, True, color)
        outline_surface = font.render(text, True, outline_color)
        x, y = pos
        # Draw outline
        self.screen.blit(outline_surface, (x-1, y-1))
        self.screen.blit(outline_surface, (x+1, y-1))
        self.screen.blit(outline_surface, (x-1, y+1))
        self.screen.blit(outline_surface, (x+1, y+1))
        # Draw text
        self.screen.blit(text_surface, (x, y))

    def _draw_map(self, game_map: SpaceshipMap):
        # Draw Rooms
        for room in game_map.rooms.values():
            rx, ry = self._world_to_screen(room.bounds.x, room.bounds.y)
            rw = room.bounds.w * self.cell_size
            rh = room.bounds.h * self.cell_size
            
            # Draw floor
            pygame.draw.rect(self.screen, room.color, (rx, ry, rw, rh))
            
            # Draw Floor Grid (Removed for cleaner look)
            # if needed, we can add very subtle tile markers later
            
            # Draw Props
            for prop in room.props:
                px, py = self._world_to_screen(prop.position.x, prop.position.y)
                pw = prop.width * self.cell_size
                ph = prop.height * self.cell_size
                
                if prop.shape == "rect":
                    # Position is center, so offset
                    rect_x = px - pw // 2
                    rect_y = py - ph // 2
                    pygame.draw.rect(self.screen, prop.color, (rect_x, rect_y, pw, ph))
                    # Add a border
                    pygame.draw.rect(self.screen, (50, 50, 50), (rect_x, rect_y, pw, ph), 1)
                elif prop.shape == "circle":
                    pygame.draw.circle(self.screen, prop.color, (px, py), pw // 2)
                    pygame.draw.circle(self.screen, (50, 50, 50), (px, py), pw // 2, 1)

            # Draw label
            # Calculate center
            cx = rx + rw // 2
            cy = ry + rh // 2
            
            text_surface = self.room_font.render(room.name.upper(), True, (200, 200, 200))
            text_rect = text_surface.get_rect(center=(cx, cy))
            
            self._draw_text_with_outline(room.name.upper(), self.room_font, (220, 220, 220), text_rect.topleft, (0, 0, 0))
            
            # Draw Vents
            for vent in room.vents:
                vx, vy = self._world_to_screen(vent.x, vent.y)
                pygame.draw.rect(self.screen, (150, 150, 150), (vx, vy, self.cell_size, self.cell_size))
                # Vent slats
                pygame.draw.line(self.screen, (50, 50, 50), (vx, vy + 2), (vx + self.cell_size, vy + 2), 1)
                pygame.draw.line(self.screen, (50, 50, 50), (vx, vy + 5), (vx + self.cell_size, vy + 5), 1)
                pygame.draw.line(self.screen, (50, 50, 50), (vx, vy + 8), (vx + self.cell_size, vy + 8), 1)

        # Draw Corridors (Walkable areas that are not in rooms)
        floor_color = (35, 35, 40) # Dark metallic gray
        
        for y in range(game_map.height):
            for x in range(game_map.width):
                if game_map.grid[y][x] == 0: # Walkable
                    # Check if inside a room
                    p = Point(x, y)
                    in_room = False
                    for room in game_map.rooms.values():
                        if room.bounds.contains(p):
                            in_room = True
                            break
                    
                    if not in_room:
                        sx, sy = self._world_to_screen(x, y)
                        # Draw slightly larger to overlap seams
                        pygame.draw.rect(self.screen, floor_color, (sx, sy, self.cell_size + 1, self.cell_size + 1))
        
        # Draw Doors
        for door in game_map.doors.values():
            dx, dy = self._world_to_screen(door.position.x, door.position.y)
            color = (200, 0, 0) if door.is_closed else (0, 200, 0)
            pygame.draw.rect(self.screen, color, (dx, dy, self.cell_size, self.cell_size))

        # Draw Tasks
        for task in game_map.tasks.values():
            tx, ty = self._world_to_screen(task.position.x, task.position.y)
            pygame.draw.circle(self.screen, (255, 255, 0), (tx + self.cell_size//2, ty + self.cell_size//2), self.cell_size//2)

    def _get_gradient_surface(self, radius: int) -> pygame.Surface:
        if radius in self.gradient_cache:
            return self.gradient_cache[radius]
        
        size = radius * 2
        surf = pygame.Surface((size, size), pygame.SRCALPHA)
        
        # Draw radial gradient
        # Center is (radius, radius)
        # We want alpha to go from 100 to 0
        for r in range(radius, 0, -2):
            alpha = int(100 * (1 - r/radius))
            # Use a yellowish white light
            color = (255, 255, 200, alpha)
            pygame.draw.circle(surf, color, (radius, radius), r)
            
        self.gradient_cache[radius] = surf
        return surf

    def _cast_vision_rays(self, player: PlayerState, game_map: SpaceshipMap) -> list[tuple[float, float]]:
        vision_radius = 10.0 # Game units
        fov_angle = math.radians(90)
        start_angle = player.facing_angle - fov_angle / 2
        
        points = []
        # Player center in world coords
        px, py = player.render_position.x, player.render_position.y
        points.append((px, py))
        
        num_rays = 30
        step_size = 0.5 # Check every 0.5 units
        
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
                # Also check props? Props are marked as 1 in grid now.
                if game_map.grid[int(check_y)][int(check_x)] == 1:
                    hit_x, hit_y = check_x, check_y
                    break
            
            points.append((hit_x, hit_y))
            
        return points

    def _draw_players(self, game_state: GameState):
        for player in game_state.players.values():
            if not player.is_alive:
                continue # Or draw dead body
                
            px, py = self._world_to_screen(player.render_position.x, player.render_position.y)
            
            # --- 1. Draw Vision Cone (FOV) ---
            # Raycast vision
            vision_poly_world = self._cast_vision_rays(player, game_state.map)
            vision_poly_screen = [self._world_to_screen(vx, vy) for vx, vy in vision_poly_world]
            
            if len(vision_poly_screen) > 2:
                # Create a mask surface for the polygon
                # Size needs to cover the vision radius
                vision_radius_px = int(10.0 * self.cell_size)
                surf_size = vision_radius_px * 2 + 20 # Margin
                
                mask_surf = pygame.Surface((surf_size, surf_size), pygame.SRCALPHA)
                
                # Center of the surface
                cx, cy = surf_size // 2, surf_size // 2
                
                # Offset polygon points to be relative to surface center
                # Player pos on screen is px, py. 
                # We want px, py to map to cx, cy.
                offset_poly = []
                for vx, vy in vision_poly_screen:
                    ox = vx - px + cx
                    oy = vy - py + cy
                    offset_poly.append((ox, oy))
                
                # Draw solid white polygon on mask
                pygame.draw.polygon(mask_surf, (255, 255, 255, 255), offset_poly)
                
                # Get gradient surface
                grad_surf = self._get_gradient_surface(vision_radius_px + 10)
                # Center gradient on mask
                gx = (surf_size - grad_surf.get_width()) // 2
                gy = (surf_size - grad_surf.get_height()) // 2
                
                # Blit gradient onto mask using MULTIPLY to mask it
                mask_surf.blit(grad_surf, (gx, gy), special_flags=pygame.BLEND_RGBA_MULT)
                
                # Blit final result to screen
                self.screen.blit(mask_surf, (px - cx, py - cy))

            # --- 2. Draw Action Radius ---
            action_radius = 2 * self.cell_size # 2 units
            pygame.draw.circle(self.screen, (255, 255, 255), (px, py), action_radius, 1)

            # --- 3. Draw Player Body (Top Down Crewmate) ---
            # Body is a circle/ellipse
            body_radius = self.cell_size * 0.8
            
            # Backpack (Rectangle behind)
            # Offset opposite to facing
            back_angle = player.facing_angle + math.pi
            bx = px + math.cos(back_angle) * (body_radius * 0.5)
            by = py + math.sin(back_angle) * (body_radius * 0.5)
            
            # Backpack rect
            pygame.draw.circle(self.screen, player.color, (bx, by), body_radius * 0.6)
            
            # Main Body
            pygame.draw.circle(self.screen, player.color, (px, py), body_radius)
            # Outline
            pygame.draw.circle(self.screen, (0, 0, 0), (px, py), body_radius, 2)
            
            # Visor (Light Blue Ellipse)
            # Offset in facing direction
            vx = px + math.cos(player.facing_angle) * (body_radius * 0.4)
            vy = py + math.sin(player.facing_angle) * (body_radius * 0.4)
            
            visor_color = (150, 200, 255)
            pygame.draw.circle(self.screen, visor_color, (vx, vy), body_radius * 0.4)
            pygame.draw.circle(self.screen, (0, 0, 0), (vx, vy), body_radius * 0.4, 1)

            # Draw name
            name_text = self.font.render(player.name, True, (255, 255, 255))
            self.screen.blit(name_text, (px, py - 20))
            
            # Draw role (debug)
            if player.is_imposter:
                role_text = self.font.render("IMP", True, (255, 0, 0))
                self.screen.blit(role_text, (px, py - 30))

    def _draw_sidebar(self, game_state: GameState):
        # Sidebar background
        sidebar_rect = pygame.Rect(self.width - self.sidebar_width, 0, self.sidebar_width, self.height)
        pygame.draw.rect(self.screen, (30, 30, 35), sidebar_rect)
        pygame.draw.line(self.screen, (100, 100, 100), (sidebar_rect.left, 0), (sidebar_rect.left, self.height), 2)
        
        # Title
        title = self.large_font.render("Crew Status", True, (255, 255, 255))
        self.screen.blit(title, (sidebar_rect.left + 20, 20))
        
        # Player List
        y_offset = 50
        for player in game_state.players.values():
            # Icon
            pygame.draw.circle(self.screen, player.color, (sidebar_rect.left + 20, y_offset + 10), 8)
            if not player.is_alive:
                # X over dead players
                pygame.draw.line(self.screen, (255, 0, 0), (sidebar_rect.left + 14, y_offset + 4), (sidebar_rect.left + 26, y_offset + 16), 2)
                pygame.draw.line(self.screen, (255, 0, 0), (sidebar_rect.left + 26, y_offset + 4), (sidebar_rect.left + 14, y_offset + 16), 2)
            
            # Name
            name_color = (255, 255, 255) if player.is_alive else (150, 150, 150)
            name_text = self.sidebar_font.render(player.name, True, name_color)
            self.screen.blit(name_text, (sidebar_rect.left + 35, y_offset))
            
            # Status / Role
            status_text = "Alive" if player.is_alive else "Dead"
            if player.is_imposter:
                status_text += " (Imposter)"
            
            # Thinking state
            status_text += f" - {player.status_message}"
            
            details_color = (180, 180, 180) if player.is_alive else (80, 80, 80)
            details_surf = self.font.render(status_text, True, details_color)
            self.screen.blit(details_surf, (sidebar_rect.left + 35, y_offset + 16))
            
            y_offset += 35
            
            y_offset += 45
            self.screen.blit(name_text, (sidebar_rect.left + 50, y_offset))
            
            # Status / Action
            status = "Alive" if player.is_alive else "Dead"
            if player.is_imposter and player.is_alive:
                status += " (Imposter)"
            
            # Mock thought/action for now since we don't have full agent state here yet
            action = "Thinking..."
            if player.render_target:
                action = "Moving"
            
            status_text = self.font.render(f"{status} - {action}", True, (180, 180, 180))
            self.screen.blit(status_text, (sidebar_rect.left + 50, y_offset + 15))
            
            y_offset += 40

    def _draw_ui(self, game_state: GameState):
        # Draw turn info
        info = f"Turn: {game_state.current_turn} | Phase: {game_state.phase.value}"
        text = self.large_font.render(info, True, (255, 255, 255))
        self.screen.blit(text, (10, 10))
