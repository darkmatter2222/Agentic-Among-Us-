"""Pygame UI renderer for Among Us game."""
import pygame
import math
from typing import Dict, Optional
from game.state import GameState, PlayerState, Position


# Colors
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
GRAY = (100, 100, 100)
DARK_GRAY = (50, 50, 50)
LIGHT_GRAY = (200, 200, 200)
RED = (255, 0, 0)
BLUE = (0, 0, 255)
GREEN = (0, 255, 0)
YELLOW = (255, 255, 0)
PURPLE = (128, 0, 128)
ORANGE = (255, 165, 0)
PINK = (255, 192, 203)
CYAN = (0, 255, 255)

PLAYER_COLORS = {
    "Red": RED,
    "Blue": BLUE,
    "Green": GREEN,
    "Yellow": YELLOW,
    "Purple": PURPLE,
    "Orange": ORANGE,
    "Pink": PINK,
    "Cyan": CYAN
}


class GameRenderer:
    """Renders the game using pygame."""
    
    def __init__(self, width: int = 1400, height: int = 800):
        pygame.init()
        pygame.font.init()
        
        self.width = width
        self.height = height
        self.screen = pygame.display.set_mode((width, height))
        pygame.display.set_caption("Among Us - AI Agents")
        
        self.font_small = pygame.font.Font(None, 20)
        self.font_medium = pygame.font.Font(None, 28)
        self.font_large = pygame.font.Font(None, 36)
        
        self.clock = pygame.time.Clock()
        
        # Map rendering area (left side)
        self.map_width = 800
        self.map_height = 600
        self.map_offset_x = 50
        self.map_offset_y = 100
        
        # Info panel area (right side)
        self.panel_x = 900
        self.panel_width = 480
        
    def handle_events(self) -> bool:
        """Handle pygame events. Returns False if should quit."""
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return False
            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    return False
        return True
    
    def render(self, game_state: GameState, current_agent: Optional[str] = None, last_action: Optional[str] = None):
        """Render the entire game state."""
        self.screen.fill(DARK_GRAY)
        
        # Draw map area background
        pygame.draw.rect(self.screen, BLACK, 
                        (self.map_offset_x, self.map_offset_y, self.map_width, self.map_height))
        
        # Draw rooms
        self._draw_rooms(game_state)
        
        # Draw tasks
        self._draw_tasks(game_state)
        
        # Draw dead bodies
        self._draw_bodies(game_state)
        
        # Draw players
        self._draw_players(game_state, current_agent)
        
        # Draw vision ranges (for current agent)
        if current_agent and current_agent in game_state.players:
            self._draw_vision(game_state, current_agent)
        
        # Draw info panel
        self._draw_info_panel(game_state, current_agent, last_action)
        
        # Draw header
        self._draw_header(game_state)
        
        pygame.display.flip()
        self.clock.tick(60)  # 60 FPS
    
    def _draw_rooms(self, game_state: GameState):
        """Draw all rooms on the map."""
        for room in game_state.rooms.values():
            x = self.map_offset_x + room.center.x - room.width / 2
            y = self.map_offset_y + room.center.y - room.height / 2
            
            # Room background
            pygame.draw.rect(self.screen, (40, 40, 60), (x, y, room.width, room.height))
            # Room border
            pygame.draw.rect(self.screen, GRAY, (x, y, room.width, room.height), 2)
            
            # Room name
            text = self.font_small.render(room.name.upper(), True, LIGHT_GRAY)
            text_rect = text.get_rect(center=(x + room.width/2, y + room.height/2))
            self.screen.blit(text, text_rect)
    
    def _draw_tasks(self, game_state: GameState):
        """Draw task locations."""
        for task in game_state.tasks.values():
            x = self.map_offset_x + task.position.x
            y = self.map_offset_y + task.position.y
            
            # Task indicator
            color = GREEN if task.completed else YELLOW
            pygame.draw.circle(self.screen, color, (int(x), int(y)), 4)
            
            if not task.completed:
                # Draw small square around incomplete tasks
                pygame.draw.rect(self.screen, color, (x-6, y-6, 12, 12), 1)
    
    def _draw_bodies(self, game_state: GameState):
        """Draw dead bodies."""
        for player_name, position in game_state.dead_bodies:
            x = self.map_offset_x + position.x
            y = self.map_offset_y + position.y
            
            # Draw X for dead body
            pygame.draw.line(self.screen, RED, (x-10, y-10), (x+10, y+10), 3)
            pygame.draw.line(self.screen, RED, (x-10, y+10), (x+10, y-10), 3)
            
            # Label
            text = self.font_small.render(player_name, True, RED)
            self.screen.blit(text, (x - text.get_width()//2, y + 15))
    
    def _draw_players(self, game_state: GameState, current_agent: Optional[str]):
        """Draw all alive players."""
        for player_name, player in game_state.players.items():
            if not player.is_alive:
                continue
            
            x = self.map_offset_x + player.position.x
            y = self.map_offset_y + player.position.y
            
            color = PLAYER_COLORS.get(player_name, WHITE)
            
            # Draw player circle
            pygame.draw.circle(self.screen, color, (int(x), int(y)), 12)
            
            # Draw border (thicker for current agent)
            border_width = 3 if player_name == current_agent else 1
            pygame.draw.circle(self.screen, WHITE, (int(x), int(y)), 12, border_width)
            
            # Draw imposter indicator (red dot) - only visible in debug
            # if player.is_imposter:
            #     pygame.draw.circle(self.screen, RED, (int(x), int(y)), 4)
            
            # Player name below
            text = self.font_small.render(player_name, True, color)
            self.screen.blit(text, (x - text.get_width()//2, y + 18))
    
    def _draw_vision(self, game_state: GameState, player_name: str):
        """Draw vision range for a player."""
        player = game_state.players[player_name]
        x = self.map_offset_x + player.position.x
        y = self.map_offset_y + player.position.y
        
        # Draw semi-transparent vision circle
        surface = pygame.Surface((self.map_width, self.map_height), pygame.SRCALPHA)
        pygame.draw.circle(surface, (255, 255, 255, 30), 
                          (int(player.position.x), int(player.position.y)), 
                          int(game_state.vision_range))
        self.screen.blit(surface, (self.map_offset_x, self.map_offset_y))
    
    def _draw_info_panel(self, game_state: GameState, current_agent: Optional[str], last_action: Optional[str]):
        """Draw the information panel on the right side."""
        y_offset = 100
        
        # Title
        title = self.font_large.render("GAME STATUS", True, WHITE)
        self.screen.blit(title, (self.panel_x, y_offset))
        y_offset += 50
        
        # Current turn info
        if current_agent:
            text = self.font_medium.render(f"Current: {current_agent}", True, PLAYER_COLORS.get(current_agent, WHITE))
            self.screen.blit(text, (self.panel_x, y_offset))
            y_offset += 30
        
        # Last action
        if last_action:
            lines = self._wrap_text(f"Action: {last_action}", self.panel_width - 20, self.font_small)
            for line in lines[:3]:  # Max 3 lines
                text = self.font_small.render(line, True, LIGHT_GRAY)
                self.screen.blit(text, (self.panel_x, y_offset))
                y_offset += 22
        
        y_offset += 20
        
        # Players alive
        alive_count = sum(1 for p in game_state.players.values() if p.is_alive)
        text = self.font_medium.render(f"Players Alive: {alive_count}/8", True, GREEN)
        self.screen.blit(text, (self.panel_x, y_offset))
        y_offset += 40
        
        # Player list
        text = self.font_medium.render("PLAYERS:", True, WHITE)
        self.screen.blit(text, (self.panel_x, y_offset))
        y_offset += 30
        
        for player_name in sorted(game_state.players.keys()):
            player = game_state.players[player_name]
            color = PLAYER_COLORS.get(player_name, WHITE)
            
            status = "ALIVE" if player.is_alive else "DEAD"
            status_color = GREEN if player.is_alive else RED
            
            # Player name
            text = self.font_small.render(f"{player_name}:", True, color)
            self.screen.blit(text, (self.panel_x, y_offset))
            
            # Status
            text = self.font_small.render(status, True, status_color)
            self.screen.blit(text, (self.panel_x + 100, y_offset))
            
            # Tasks (for crewmates)
            if player.is_alive and not player.is_imposter:
                tasks_done = len(player.tasks_completed)
                text = self.font_small.render(f"Tasks: {tasks_done}/{player.total_tasks}", True, LIGHT_GRAY)
                self.screen.blit(text, (self.panel_x + 200, y_offset))
            
            y_offset += 25
        
        # Total task progress
        y_offset += 20
        total_tasks = len(game_state.tasks)
        completed_tasks = sum(1 for t in game_state.tasks.values() if t.completed)
        text = self.font_medium.render(f"Total Tasks: {completed_tasks}/{total_tasks}", True, YELLOW)
        self.screen.blit(text, (self.panel_x, y_offset))
    
    def _draw_header(self, game_state: GameState):
        """Draw the header with game info."""
        title = self.font_large.render("AMONG US - AI AGENTS", True, WHITE)
        self.screen.blit(title, (self.width//2 - title.get_width()//2, 20))
        
        # Turn counter
        turn_text = self.font_medium.render(f"Turn: {game_state.current_turn}", True, LIGHT_GRAY)
        self.screen.blit(turn_text, (self.width//2 - turn_text.get_width()//2, 60))
    
    def _wrap_text(self, text: str, max_width: int, font) -> list:
        """Wrap text to fit within max_width."""
        words = text.split(' ')
        lines = []
        current_line = ""
        
        for word in words:
            test_line = current_line + (" " if current_line else "") + word
            if font.size(test_line)[0] <= max_width:
                current_line = test_line
            else:
                if current_line:
                    lines.append(current_line)
                current_line = word
        
        if current_line:
            lines.append(current_line)
        
        return lines
    
    def show_message(self, message: str, duration_ms: int = 2000):
        """Show a message overlay."""
        overlay = pygame.Surface((self.width, self.height), pygame.SRCALPHA)
        overlay.fill((0, 0, 0, 180))
        self.screen.blit(overlay, (0, 0))
        
        # Message box
        box_width = 600
        box_height = 200
        box_x = (self.width - box_width) // 2
        box_y = (self.height - box_height) // 2
        
        pygame.draw.rect(self.screen, DARK_GRAY, (box_x, box_y, box_width, box_height))
        pygame.draw.rect(self.screen, WHITE, (box_x, box_y, box_width, box_height), 3)
        
        # Message text
        lines = self._wrap_text(message, box_width - 40, self.font_medium)
        y_offset = box_y + 30
        
        for line in lines:
            text = self.font_medium.render(line, True, WHITE)
            text_rect = text.get_rect(center=(self.width//2, y_offset))
            self.screen.blit(text, text_rect)
            y_offset += 35
        
        pygame.display.flip()
        pygame.time.wait(duration_ms)
    
    def quit(self):
        """Cleanup pygame."""
        pygame.quit()
