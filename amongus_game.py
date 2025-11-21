import asyncio
import pygame
import random
import math
import logging
import sys
from game.state import GameState, Position
from game.pathfinding import Pathfinder
from agents.threaded_agent import ThreadedAgent
from ui.renderer import GameRenderer
from llama_client import LlamaCppChatCompletion

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler("game_debug.log"),
        logging.StreamHandler(sys.stdout)
    ]
)

async def test_llm_connection(llm_client):
    from semantic_kernel.contents import ChatHistory
    from semantic_kernel.connectors.ai.prompt_execution_settings import PromptExecutionSettings
    
    test_chat = ChatHistory()
    test_chat.add_user_message("Hello, are you ready to play Among Us?")
    response = await llm_client.get_chat_message_contents(
        chat_history=test_chat,
        settings=PromptExecutionSettings()
    )
    return response

def main():
    logging.info("Starting Among Us Agent Runner...")
    # Initialize Game State
    game_state = GameState()
    
    # Initialize LLM Client
    # Note: Ensure your local llama.cpp server is running!
    llm_client = LlamaCppChatCompletion()
    
    # Test LLM Connection
    print("Testing LLM connection...")
    try:
        response = asyncio.run(test_llm_connection(llm_client))
        print(f"LLM Connection Successful! Response: {response[0].content}")
    except Exception as e:
        print(f"CRITICAL ERROR: LLM Connection Failed: {e}")
        print("Please ensure llama.cpp server is running at http://192.168.86.48:8080")
        return

    # Initialize Pathfinder
    pathfinder = Pathfinder(game_state.map)
    
    # Add Players
    colors = [
        (255, 0, 0), (0, 0, 255), (0, 255, 0), (255, 255, 0),
        (255, 0, 255), (0, 255, 255), (255, 255, 255), (100, 100, 100)
    ]
    
    agents = []
    
    for i in range(8):
        is_imposter = (i == 0) # First player is imposter
        name = f"Player_{i}"
        game_state.add_player(name, is_imposter, colors[i])
        
        # Create and start agent thread
        agent = ThreadedAgent(name, game_state, pathfinder, llm_client)
        agent.start()
        agents.append(agent)

    # Initialize Renderer
    # Map is 100x80 (5:4 aspect ratio). 
    # 1200x960 preserves this ratio perfectly for the map area.
    # We add 300px for the sidebar -> 1500x960
    renderer = GameRenderer(1500, 960) 
    
    # Game Loop
    clock = pygame.time.Clock()
    running = True
    
    try:
        while running:
            delta_time = clock.tick(60) / 1000.0
            
            # Handle Events
            running = renderer.handle_events()
            
            # Update Physics (Movement along paths)
            game_state.update_physics(delta_time)
            
            # Update Timers (Cooldowns)
            game_state.update_timers(delta_time)
            
            # Update Animations (Smoothing for render)
            game_state.update_animations(delta_time)
            
            # Render
            renderer.render(game_state)
            
            # No await asyncio.sleep(0) needed in sync loop
    except BaseException as e:
        import traceback
        traceback.print_exc()
        logging.critical(f"CRITICAL ERROR IN MAIN LOOP: {e}")
        print(f"CRITICAL ERROR IN MAIN LOOP: {e}")
    finally:
        # Cleanup threads
        for agent in agents:
            agent.stop()
        for agent in agents:
            agent.join(timeout=1.0)

if __name__ == "__main__":
    main()
