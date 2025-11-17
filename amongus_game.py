"""
"""Among Us - AI Agent Game.

A simulation where 8 AI agents play Among Us with 2 imposters.
Uses Semantic Kernel and llama.cpp for agent decision-making.
"""
import asyncio
import random
from typing import Optional

from game.state import GameState, Position, GamePhase
from agents.agent_manager import AgentManager
from ui.renderer import GameRenderer


async def main():
    print("=" * 80)
    print("AMONG US - AI AGENT GAME")
    print("=" * 80)
    print()
    
    # Initialize game state
    game_state = GameState()
    game_state.initialize_map()
    game_state.initialize_tasks()
    
    # Create spawn positions in cafeteria
    spawn_positions = [
        Position(180, 180), Position(220, 180),
        Position(180, 220), Position(220, 220),
        Position(160, 200), Position(240, 200),
        Position(200, 160), Position(200, 240),
    ]
    
    # Initialize agents
    agent_manager = AgentManager(game_state)
    agent_manager.create_agents()
    
    # Add players to game state
    for i, (agent_name, agent) in enumerate(agent_manager.agents.items()):
        is_imposter = agent_name in agent_manager.imposters
        game_state.add_player(agent_name, is_imposter, spawn_positions[i])
    
    print("\n🎮 Game initialized!")
    print("📍 All players spawned in Cafeteria")
    print("\n" + "=" * 80)
    
    # Initialize UI
    renderer = GameRenderer()
    
    # Game loop
    running = True
    player_order = list(agent_manager.agents.keys())
    current_player_idx = 0
    
    while running:
        # Handle pygame events
        if not renderer.handle_events():
            running = False
            break
        
        # Check win condition
        winner = game_state.check_win_condition()
        if winner:
            message = f"🎉 {winner.upper()} WIN!"
            if winner == "imposters":
                message += f" Imposters: {', '.join(agent_manager.imposters)}"
            renderer.show_message(message, duration_ms=5000)
            running = False
            break
        
        # Get current player
        current_agent = player_order[current_player_idx]
        player = game_state.players[current_agent]
        
        # Skip if player is dead
        if not player.is_alive:
            current_player_idx = (current_player_idx + 1) % len(player_order)
            continue
        
        # Build context for agent
        context = build_agent_context(game_state, current_agent)
        
        # Render before action
        renderer.render(game_state, current_agent, None)
        
        # Get agent decision
        print(f"\n[Turn {game_state.current_turn}] {current_agent}'s turn...")
        
        try:
            response = await agent_manager.get_agent_action(current_agent, context)
            print(f"  → {current_agent}: {response[:100]}...")
            
            # Render after action
            renderer.render(game_state, current_agent, player.last_action)
            
            # Small delay to show action
            await asyncio.sleep(0.5)
            
        except Exception as e:
            print(f"  ❌ Error: {e}")
        
        # Update cooldowns
        game_state.update_cooldowns()
        
        # Move to next player
        current_player_idx = (current_player_idx + 1) % len(player_order)
        
        # Increment turn after all players have gone
        if current_player_idx == 0:
            game_state.current_turn += 1
        
        # Optional: Limit total turns for testing
        if game_state.current_turn >= 100:
            renderer.show_message("Game ended - Turn limit reached!", duration_ms=3000)
            running = False
            break
    
    # Game over
    print("\n" + "=" * 80)
    print("GAME OVER")
    print("=" * 80)
    
    if winner:
        print(f"\n🏆 {winner.upper()} WIN!")
        if winner == "imposters":
            print(f"   Imposters were: {', '.join(agent_manager.imposters)}")
    
    # Show final stats
    print("\nFinal Statistics:")
    print(f"  Turns played: {game_state.current_turn}")
    print(f"  Players alive: {sum(1 for p in game_state.players.values() if p.is_alive)}")
    print(f"  Tasks completed: {sum(1 for t in game_state.tasks.values() if t.completed)}/{len(game_state.tasks)}")
    
    # Keep window open until user closes
    print("\nClose the game window to exit...")
    while renderer.handle_events():
        renderer.render(game_state, None, "Game Over")
        await asyncio.sleep(0.1)
    
    renderer.quit()


def build_agent_context(game_state: GameState, agent_name: str) -> str:
    """Build context string for an agent's decision."""
    player = game_state.players[agent_name]
    
    # Get what player can see
    visible_players = game_state.get_visible_players(agent_name)
    nearby_tasks = game_state.get_nearby_tasks(agent_name, max_distance=100.0)
    
    # Find current room
    current_room = "hallway"
    for room in game_state.rooms.values():
        if room.contains(player.position):
            current_room = room.name
            break
    
    context = f"""You are at position ({player.position.x:.0f}, {player.position.y:.0f}) in {current_room}.

VISIBLE PLAYERS: {', '.join(visible_players) if visible_players else 'None (you are alone)'}

NEARBY TASKS: {', '.join([f"{t.name} in {t.room}" for t in nearby_tasks[:3]]) if nearby_tasks else 'None nearby'}

YOUR STATUS: {'ALIVE' if player.is_alive else 'DEAD'}
"""
    
    if not player.is_imposter:
        tasks_done = len(player.tasks_completed)
        context += f"TASKS COMPLETED: {tasks_done}/{player.total_tasks}\n"
    else:
        cooldown = game_state.kill_cooldown.get(agent_name, 0)
        context += f"KILL COOLDOWN: {'Ready!' if cooldown == 0 else f'{cooldown} turns'}\n"
    
    # Add recent events
    if game_state.dead_bodies:
        context += f"\nDEAD BODIES DISCOVERED: {len(game_state.dead_bodies)}\n"
    
    context += "\nWhat do you do? Choose ONE action using the available functions."
    
    return context


if __name__ == "__main__":
    asyncio.run(main())
