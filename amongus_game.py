import asyncio
import pygame
import random
import math
from game.state import GameState, Position
from ui.renderer import GameRenderer

async def main():
    # Initialize Game State
    game_state = GameState()
    
    # Add Players
    colors = [
        (255, 0, 0), (0, 0, 255), (0, 255, 0), (255, 255, 0),
        (255, 0, 255), (0, 255, 255), (255, 255, 255), (100, 100, 100)
    ]
    
    for i in range(8):
        is_imposter = (i == 0) # First player is imposter
        game_state.add_player(f"Player_{i}", is_imposter, colors[i])

    # Initialize Renderer
    # Map is 100x80 (5:4 aspect ratio). 
    # 1200x960 preserves this ratio perfectly for the map area.
    # We add 300px for the sidebar -> 1500x960
    renderer = GameRenderer(1500, 960) 
    
    # Game Loop
    clock = pygame.time.Clock()
    running = True
    
    while running:
        delta_time = clock.tick(60) / 1000.0
        
        # Handle Events
        running = renderer.handle_events()
        
        # Update Logic (Simulation)
        # For now, just move players randomly to test map
        for player in game_state.players.values():
            if not player.render_target:
                # Pick a random nearby walkable point
                current_x = int(player.position.x)
                current_y = int(player.position.y)
                
                # Try random moves
                moves = [(0, 1), (0, -1), (1, 0), (-1, 0)]
                random.shuffle(moves)
                
                for dx, dy in moves:
                    nx, ny = current_x + dx, current_y + dy
                    if game_state.map.is_walkable(nx, ny):
                        # Move there
                        player.position = Position(nx, ny)
                        player.render_start = player.render_position
                        player.render_target = Position(nx, ny)
                        player.animation_timer = 0
                        player.animation_duration = 0.5 # 0.5 seconds per tile
                        
                        # Update facing angle
                        player.facing_angle = math.atan2(dy, dx)
                        
                        # Update status message (debug)
                        actions = ["Patrolling", "Fixing Wiring", "Scanning", "Idle", "Sus"]
                        player.status_message = actions[random.randint(0, len(actions)-1)]
                        break
        
        # Update Animations
        game_state.update_animations(delta_time)
        
        # Render
        renderer.render(game_state)
        
        await asyncio.sleep(0)

if __name__ == "__main__":
    asyncio.run(main())
