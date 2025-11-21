from typing import List
from game.state import PlayerState, GameState, Task, GamePhase
from game.vision import VisionSystem
from game.map_layouts import Point

class PromptBuilder:
    @staticmethod
    def build_system_prompt(agent_name: str, is_imposter: bool) -> str:
        role = "Imposter" if is_imposter else "Crewmate"
        goal = "Kill crewmates and sabotage the ship without getting caught." if is_imposter else "Complete tasks and find the imposter."
        
        prompt = f"""You are {agent_name}, a {role} in a game of Among Us.
Your goal: {goal}

Game Rules:
- Movement takes time. You must walk to rooms.
- You can only see what is in your line of sight.
- Crewmates must complete tasks to win.
- Imposters can kill crewmates (cooldown applies) and vent.
- If you see a dead body, you should REPORT it.
- During meetings, you must discuss and vote. You cannot move or do tasks.

You are an autonomous agent. You must decide your next action based on your observation.
Reply with a concise thought and an action in the following format:
Thought: [Your reasoning here]
ACTION: [COMMAND] [ARGS]

Available Commands:
- MOVE [RoomName] : Move to a specific room. (PLAYING phase only)
- TASK : Do a nearby task (if available). (PLAYING phase only)
- KILL [PlayerName] : Kill a player (Imposter only, must be close). (PLAYING phase only)
- REPORT [BodyName] : Report a dead body (must be close). (PLAYING phase only)
- WAIT : Do nothing for now.
- VOTE [PlayerName] : Vote for a player during a meeting. (MEETING phase only)
- SKIP : Vote to skip during a meeting. (MEETING phase only)
- CHAT [Message] : Say something during a meeting. (MEETING phase only)

Example:
Thought: I need to do my wiring task in Admin.
ACTION: MOVE Admin
"""
        return prompt

    @staticmethod
    def build_observation_prompt(agent_name: str, game_state: GameState) -> str:
        me = game_state.players.get(agent_name)
        if not me: return "Error: Player not found."
        
        # Check Phase
        if game_state.phase == GamePhase.MEETING:
            obs = f"""
MEETING IN PROGRESS!
You are in the Cafeteria with other players.
Discuss who the imposter is and vote.
Meeting Caller: {game_state.meeting_called_by}

Visible Players: {', '.join([p.name for p in game_state.players.values() if p.is_alive])}

What is your vote or argument?
"""
            return obs

        # 1. Location
        current_room = "Corridor"
        p = Point(int(me.position.x), int(me.position.y))
        for room in game_state.map.rooms.values():
            if room.bounds.contains(p):
                current_room = room.name
                break
        
        # 2. Vision (Players & Bodies)
        visible_entities = []
        for other_name, other_player in game_state.players.items():
            if other_name == agent_name: continue
            
            if VisionSystem.is_visible(me, other_player, game_state.map):
                status = "Dead Body" if not other_player.is_alive else "Alive"
                visible_entities.append(f"{other_name} ({status})")
        
        # 3. Tasks (Crewmate)
        task_info = ""
        if not me.is_imposter:
            pending_tasks = []
            for task_id in me.assigned_tasks:
                if task_id not in me.tasks_completed:
                    task = game_state.tasks[task_id]
                    dist = me.position.distance_to(task.position)
                    status = "NEARBY" if dist < 2.0 else f"in {task.room_name}"
                    pending_tasks.append(f"- {task.name} ({status})")
            
            if pending_tasks:
                task_info = "Your Tasks:\n" + "\n".join(pending_tasks)
            else:
                task_info = "All tasks completed!"
        
        # 4. Imposter Info
        imposter_info = ""
        if me.is_imposter:
            imposter_info = f"Kill Cooldown: {me.kill_timer:.1f}s\n"
            if me.kill_timer <= 0:
                imposter_info += "KILL AVAILABLE! (Target must be close)\n"
        
        # Construct Prompt
        obs = f"""
Current Status:
- Location: {current_room}
- Visible: {', '.join(visible_entities) if visible_entities else 'None'}
{task_info}
{imposter_info}
- Status: {me.status_message}

What is your next move?
"""
        return obs
