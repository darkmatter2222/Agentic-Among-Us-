import threading
import time
import random
import logging
import traceback
from typing import Optional
from game.state import GameState, PlayerState, GamePhase
from game.pathfinding import Pathfinder
from game.vision import VisionSystem
from game.map_layouts import Point
from agents.prompt_builder import PromptBuilder
import asyncio
from semantic_kernel.contents import ChatHistory
from semantic_kernel.connectors.ai.prompt_execution_settings import PromptExecutionSettings

class ThreadedAgent(threading.Thread):
    def __init__(self, name: str, game_state: GameState, pathfinder: Pathfinder, llm_client=None):
        super().__init__(name=name, daemon=True)
        self.agent_name = name
        self.game_state = game_state
        self.pathfinder = pathfinder
        self.llm_client = llm_client
        self.running = True
        self.current_task = None
        self.last_thought_time = 0
        self.thought_cooldown = 5.0 # Think every 5 seconds if idle
        
    def run(self):
        logging.info(f"Agent {self.agent_name} started.")
        
        # Initial delay to stagger starts
        time.sleep(random.uniform(0, 2))
        
        try:
            while self.running:
                if self.game_state.phase != GamePhase.PLAYING:
                    time.sleep(0.5)
                    continue
                    
                # 1. Observe
                # (In future, build prompt here)
                obs = self.get_observation()
                if random.random() < 0.01: # Print occasionally (1% chance per tick)
                    logging.debug(f"[{self.agent_name} OBS]:\n{obs}")
                
                # 2. Decide
                if self.llm_client:
                    current_time = time.time()
                    
                    # Check if moving
                    is_moving = False
                    with self.game_state.lock:
                        p = self.game_state.players.get(self.agent_name)
                        if p and p.path:
                            is_moving = True
                    
                    # If moving, wait longer (don't interrupt movement unless necessary)
                    # If idle, think faster
                    cooldown = 5.0 if is_moving else 2.0
                    
                    if current_time - self.last_thought_time > cooldown:
                        self._decide_with_llm()
                        self.last_thought_time = current_time
                else:
                    # No LLM, do nothing (or log error)
                    pass
                
                # 3. Act (handled by setting state that main loop processes)
                
                # Tick rate for decision making (not physics)
                time.sleep(0.5)
        except Exception as e:
            logging.error(f"CRITICAL ERROR in Agent {self.agent_name}: {e}")
            logging.error(traceback.format_exc())

    def get_observation(self) -> str:
        """Build a text description of what the agent sees."""
        with self.game_state.lock:
            me = self.game_state.players.get(self.agent_name)
            if not me: return ""
            
            # Visible Players
            visible_players = []
            for other_name, other_player in self.game_state.players.items():
                if other_name == self.agent_name:
                    continue
                if VisionSystem.is_visible(me, other_player, self.game_state.map):
                    status = "Dead" if not other_player.is_alive else "Alive"
                    visible_players.append(f"{other_name} ({status})")
            
            # Visible Tasks
            visible_tasks = []
            for task_id in me.assigned_tasks:
                if task_id not in me.tasks_completed:
                    task = self.game_state.tasks[task_id]
                    # Simple check: if in same room or close
                    if me.position.distance_to(task.position) < 10.0: # Vision radius
                         visible_tasks.append(f"{task.name} at {task.room_name}")

            # Current Room
            current_room = "Corridor"
            p = Point(int(me.position.x), int(me.position.y))
            for room in self.game_state.map.rooms.values():
                if room.bounds.contains(p):
                    current_room = room.name
                    break
            
            obs = f"You are {self.agent_name} in {current_room}.\n"
            obs += f"Visible Players: {', '.join(visible_players) if visible_players else 'None'}\n"
            obs += f"Nearby Tasks: {', '.join(visible_tasks) if visible_tasks else 'None'}\n"
            obs += f"Status: {me.status_message}"
            
            return obs

    def _simple_behavior(self):
        pass # Deprecated

    def _decide_with_llm(self):
        """Use LLM to decide next action."""
        try:
            # Build Prompts (Snapshot state first)
            with self.game_state.lock:
                player = self.game_state.players.get(self.agent_name)
                if not player: return
                if not player.is_alive: return # Dead players don't act
                is_imposter = player.is_imposter
            
            # These methods access game_state, so they might need locking or be safe.
            # build_observation_prompt accesses players and map.
            # Let's assume we need to lock for consistency, but it's fast string building.
            # Ideally PromptBuilder should take a snapshot, but for now we lock briefly.
            
            system_prompt = PromptBuilder.build_system_prompt(self.agent_name, is_imposter)
            
            # We need to lock while reading state for observation
            # But we don't want to hold it while LLM thinks.
            # So we build the prompt string inside the lock (fast), then call LLM outside.
            with self.game_state.lock:
                obs_prompt = PromptBuilder.build_observation_prompt(self.agent_name, self.game_state)
            
            chat = ChatHistory()
            chat.add_system_message(system_prompt)
            chat.add_user_message(obs_prompt)
            
            # Run LLM (Synchronously in this thread, NO LOCK HELD)
            # Note: asyncio.run creates a new loop for this call
            response = asyncio.run(self.llm_client.get_chat_message_contents(
                chat_history=chat,
                settings=PromptExecutionSettings()
            ))
            
            if response:
                content = response[0].content
                logging.info(f"[{self.agent_name} THOUGHT]: {content}")
                self._parse_and_execute_llm_action(content)
                
        except Exception as e:
            logging.error(f"[{self.agent_name} ERROR]: LLM failed - {e}")
            logging.error(traceback.format_exc())

    def _parse_and_execute_llm_action(self, content: str):
        """Parse LLM output and execute action."""
        # Expected format: "Thought... ACTION: COMMAND ARGS"
        if "ACTION:" not in content:
            return
            
        action_part = content.split("ACTION:")[1].strip()
        parts = action_part.split()
        if not parts:
            return
            
        command = parts[0].upper()
        args = parts[1:]
        
        # Check Phase
        if self.game_state.phase == GamePhase.MEETING:
            if command in ["MOVE", "TASK", "KILL", "REPORT"]:
                logging.warning(f"[{self.agent_name}] Attempted {command} during MEETING. Ignored.")
                return
            
            if command == "CHAT":
                msg = " ".join(args)
                logging.info(f"[{self.agent_name} CHAT]: {msg}")
                # TODO: Add to chat history in game state
                return
                
            if command == "VOTE":
                target = args[0] if args else "Skip"
                logging.info(f"[{self.agent_name} VOTE]: {target}")
                # TODO: Register vote
                return
                
            if command == "SKIP":
                logging.info(f"[{self.agent_name} VOTE]: SKIP")
                return

        # Execute
        if command == "MOVE":
            # MOVE RoomName
            if not args: return
            room_name = " ".join(args) # Handle spaces in room names
            
            # Normalize room name (replace underscores with spaces)
            room_name = room_name.replace("_", " ")
            
            # Aliases
            aliases = {
                "comms": "Communications",
                "upperengine": "Upper Engine",
                "lowerengine": "Lower Engine",
                "med": "MedBay",
                "nav": "Navigation",
                "elec": "Electrical"
            }
            if room_name.lower() in aliases:
                room_name = aliases[room_name.lower()]
            
            # Find room
            target_room = None
            # Map access needs no lock if read-only, but let's be safe or snapshot if needed.
            # Map is static.
            for r in self.game_state.map.rooms.values():
                if r.name.lower() == room_name.lower():
                    target_room = r
                    break
            
            if target_room:
                # Pathfind (Heavy, outside lock)
                with self.game_state.lock:
                    player = self.game_state.players.get(self.agent_name)
                    if not player: return
                    start_pos = (int(player.position.x), int(player.position.y))
                
                # Find a walkable target in the room
                # Try to pick a random point in the room to avoid stacking and encourage movement
                import random
                end_pos = None
                
                # Try 10 times to find a random walkable point
                for _ in range(10):
                    rx = random.randint(target_room.bounds.x, target_room.bounds.x + target_room.bounds.w)
                    ry = random.randint(target_room.bounds.y, target_room.bounds.y + target_room.bounds.h)
                    if self.game_state.map.is_walkable(rx, ry):
                        end_pos = (rx, ry)
                        break
                
                # Fallback to center if random fails
                if not end_pos:
                    target_center = target_room.bounds.center
                    end_pos = (target_center.x, target_center.y)
                
                # If center is not walkable (rare but possible), spiral out
                if not self.game_state.map.is_walkable(end_pos[0], end_pos[1]):
                    found_walkable = False
                    # Spiral search with larger radius
                    for r in range(1, max(target_room.bounds.w, target_room.bounds.h)):
                        for dy in range(-r, r + 1):
                            for dx in range(-r, r + 1):
                                # Only check the perimeter of the square
                                if abs(dx) != r and abs(dy) != r: continue
                                
                                tx, ty = end_pos[0] + dx, end_pos[1] + dy
                                if target_room.bounds.contains(Point(tx, ty)) and self.game_state.map.is_walkable(tx, ty):
                                    end_pos = (tx, ty)
                                    found_walkable = True
                                    break
                            if found_walkable: break
                        if found_walkable: break
                    
                    if not found_walkable:
                        logging.warning(f"[{self.agent_name}] Could not find walkable point in {target_room.name}")
                        # Fallback to center and let pathfinder try its best or fail
                        # end_pos is already center

                path = self.pathfinder.find_path(start_pos, end_pos)
                
                if path:
                    smoothed_path = self.pathfinder.smooth_path(path)
                    with self.game_state.lock:
                        player = self.game_state.players.get(self.agent_name)
                        if player:
                            player.path = smoothed_path
                            player.current_path_index = 0
                            player.status_message = f"Moving to {target_room.name}"
                            logging.info(f"[{self.agent_name}] Path set to {target_room.name}. Steps: {len(smoothed_path)}")
                else:
                    logging.warning(f"[{self.agent_name}] Pathfinding failed from {start_pos} to {end_pos} ({target_room.name})")
            else:
                logging.warning(f"[{self.agent_name}] Room not found: {room_name}")
                            
        elif command == "KILL":
            # KILL PlayerName
            if not args: return
            target_name = args[0]
            with self.game_state.lock:
                self.game_state.attempt_kill(self.agent_name, target_name)
                
        elif command == "REPORT":
            # REPORT BodyName
            if not args: return
            body_name = args[0]
            # Find body pos
            body_pos = None
            with self.game_state.lock:
                for b_name, b_pos in self.game_state.dead_bodies:
                    if b_name == body_name:
                        body_pos = b_pos
                        break
                
                if body_pos:
                    self.game_state.report_body(self.agent_name, (body_name, body_pos))

        elif command == "TASK":
            # TASK TaskID (or name?)
            # LLM sees "TaskName at Room". It doesn't see ID easily unless we put it in prompt.
            # Let's assume it tries to do a task by name or just "TASK" means "Do nearby task"
            with self.game_state.lock:
                player = self.game_state.players.get(self.agent_name)
                if not player: return
                
                # Find nearby task
                for tid in player.assigned_tasks:
                    if tid not in player.tasks_completed:
                        t = self.game_state.tasks[tid]
                        if player.position.distance_to(t.position) < 2.0:
                            self.game_state.complete_task(self.agent_name, tid)
                            player.status_message = f"Doing {t.name}"
                            break

    def stop(self):
        self.running = False
