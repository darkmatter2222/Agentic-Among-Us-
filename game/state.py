"""Game state management for Among Us."""
import math
import random
import threading
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple
import uuid

from game.map_layouts import SpaceshipMap, Point, Room

class GamePhase(Enum):
    """Current phase of the game."""
    PLAYING = "playing"
    MEETING = "meeting"
    VOTING = "voting"
    GAME_OVER = "game_over"

@dataclass
class Position:
    """2D position on the map (float for smooth movement)."""
    x: float
    y: float
    
    def distance_to(self, other: 'Position') -> float:
        """Calculate Euclidean distance to another position."""
        return math.sqrt((self.x - other.x)**2 + (self.y - other.y)**2)
    
    def to_tuple(self) -> Tuple[float, float]:
        return (self.x, self.y)
    
    def to_point(self) -> Point:
        return Point(int(self.x), int(self.y))

@dataclass
class Task:
    """A task that needs to be completed."""
    id: str
    name: str
    room_name: str
    position: Position
    completed: bool = False
    type: str = "normal"  # normal, common, short, long

@dataclass
class PlayerState:
    """State of a single player/agent."""
    name: str
    position: Position
    is_imposter: bool
    is_alive: bool = True
    tasks_completed: Set[str] = field(default_factory=set)
    assigned_tasks: List[str] = field(default_factory=list) # List of Task IDs
    total_tasks: int = 3
    last_action: Optional[str] = None
    suspicion_levels: Dict[str, int] = field(default_factory=dict)  # player_name -> suspicion (0-10)
    is_in_vent: bool = False
    current_vent: Optional[str] = None
    
    # Imposter specific
    kill_cooldown: float = 30.0
    kill_timer: float = 10.0 # Start with some cooldown
    
    # Pathfinding & Movement
    path: List[Tuple[float, float]] = field(default_factory=list)
    current_path_index: int = 0
    velocity: Position = field(default_factory=lambda: Position(0.0, 0.0))
    speed: float = 4.0 # Units per second
    
    # Rendering / Animation
    render_position: Position = field(default_factory=lambda: Position(0.0, 0.0))
    render_start: Position = field(default_factory=lambda: Position(0.0, 0.0))
    render_target: Optional[Position] = None
    animation_timer: float = 0.0
    animation_duration: float = 0.0
    facing_angle: float = 0.0 # Radians
    color: Tuple[int, int, int] = (255, 255, 255)
    status_message: str = "Idle"

class GameState:
    """Manages the entire game state."""
    
    def __init__(self) -> None:
        self.phase = GamePhase.PLAYING
        self.players: Dict[str, PlayerState] = {}
        self.tasks: Dict[str, Task] = {} # All tasks in the game
        self.dead_bodies: List[Tuple[str, Position]] = []  # (player_name, position)
        self.current_turn: int = 0
        self.meeting_called_by: Optional[str] = None
        self.votes: Dict[str, str] = {}
        
        # Thread Safety
        self.lock = threading.Lock()
        
        # Map
        self.map = SpaceshipMap()
        
        # Config
        self.config = {
            'render_movement_speed': 10.0, # Grid units per second
        }

    def generate_tasks_for_player(self, player_name: str):
        """Generate a set of tasks for a player."""
        # Simple implementation: 3 random tasks in random rooms
        room_names = list(self.map.rooms.keys())
        if not room_names:
            return

        player = self.players[player_name]
        if player.is_imposter:
            # Imposters get fake tasks (same structure but they don't count)
            pass
        
        for i in range(3):
            room_name = random.choice(room_names)
            room = self.map.rooms[room_name]
            
            # Create a task in this room
            task_id = str(uuid.uuid4())
            task_pos = Position(room.bounds.center.x, room.bounds.center.y)
            
            task = Task(
                id=task_id,
                name=f"Fix Wiring in {room_name}",
                room_name=room_name,
                position=task_pos
            )
            
            self.tasks[task_id] = task
            player.assigned_tasks.append(task_id)
            
    def complete_task(self, player_name: str, task_id: str) -> bool:
        """Mark a task as complete."""
        with self.lock:
            if task_id not in self.tasks:
                return False
            
            task = self.tasks[task_id]
            player = self.players.get(player_name)
            
            if not player:
                return False
                
            if task_id in player.assigned_tasks and task_id not in player.tasks_completed:
                player.tasks_completed.add(task_id)
                task.completed = True # Note: In real Among Us, tasks are per-player. 
                                    # Here we simplify: unique task instance per player assignment.
                return True
            return False

    def attempt_kill(self, killer_name: str, target_name: str) -> Tuple[bool, str]:
        """Attempt to kill a target player."""
        with self.lock:
            killer = self.players.get(killer_name)
            target = self.players.get(target_name)
            
            if not killer or not target:
                return False, "Player not found"
            
            if not killer.is_imposter:
                return False, "Not an imposter"
            
            if not killer.is_alive:
                return False, "Killer is dead"
                
            if not target.is_alive:
                return False, "Target already dead"
                
            if killer.kill_timer > 0:
                return False, f"Kill cooldown: {killer.kill_timer:.1f}s"
                
            # Check distance
            dist = killer.position.distance_to(target.position)
            if dist > 2.0: # Kill distance
                return False, "Target too far"
                
            # Execute Kill
            target.is_alive = False
            target.status_message = "DEAD"
            self.dead_bodies.append((target_name, Position(target.position.x, target.position.y)))
            
            killer.kill_timer = killer.kill_cooldown
            killer.status_message = f"Killed {target_name}"
            killer.last_action = "kill"
            
            return True, "Kill successful"

    def report_body(self, reporter_name: str, body_info: Tuple[str, Position]) -> Tuple[bool, str]:
        """Report a dead body."""
        with self.lock:
            reporter = self.players.get(reporter_name)
            if not reporter or not reporter.is_alive:
                return False, "Invalid reporter"
                
            # Check distance to body
            body_name, body_pos = body_info
            dist = reporter.position.distance_to(body_pos)
            
            if dist > 3.0: # Report distance
                return False, "Too far to report"
                
            # Trigger Meeting
            self.phase = GamePhase.MEETING
            self.meeting_called_by = reporter_name
            
            # Teleport everyone to cafeteria
            cafeteria = self.map.rooms.get("Cafeteria")
            if cafeteria:
                center = cafeteria.bounds.center
                for p in self.players.values():
                    if p.is_alive:
                        # Teleport with jitter
                        p.position.x = center.x + random.uniform(-3, 3)
                        p.position.y = center.y + random.uniform(-3, 3)
                        p.path = [] # Stop moving
                        p.status_message = "In Meeting"
            
            return True, "Body reported! Meeting started."

    def update_timers(self, delta_time: float):
        """Update game timers (cooldowns, etc)."""
        with self.lock:
            if self.phase == GamePhase.PLAYING:
                for player in self.players.values():
                    if player.is_imposter and player.kill_timer > 0:
                        player.kill_timer = max(0, player.kill_timer - delta_time)

    def add_player(self, name: str, is_imposter: bool, color: Tuple[int, int, int]):
        """Add a player to the game."""
        with self.lock:
            # Pick a random spawn point
            spawn_point = random.choice(self.map.spawn_points)
            # Add some jitter so they don't stack perfectly
            jitter_x = random.uniform(-1, 1)
            jitter_y = random.uniform(-1, 1)
            
            pos = Position(spawn_point.x + jitter_x, spawn_point.y + jitter_y)
            
            player = PlayerState(
                name=name,
                position=pos,
                is_imposter=is_imposter,
                color=color
            )
            player.render_position = Position(pos.x, pos.y)
            player.render_start = Position(pos.x, pos.y)
            
            self.players[name] = player
            
            # Generate tasks for the new player
            self.generate_tasks_for_player(name)
        
    def update_animations(self, delta_time: float):
        """Update player render positions based on animation state."""
        with self.lock:
            for player in self.players.values():
                # Interpolate render position towards actual position for smoothness
                # This is a simple exponential smoothing
                smoothing_factor = 10.0 * delta_time
                player.render_position.x += (player.position.x - player.render_position.x) * smoothing_factor
                player.render_position.y += (player.position.y - player.render_position.y) * smoothing_factor

    def update_physics(self, delta_time: float):
        """Update player positions based on pathfinding."""
        with self.lock:
            moving_count = 0
            for player in self.players.values():
                if not player.path or player.current_path_index >= len(player.path):
                    continue
                
                moving_count += 1
                target = player.path[player.current_path_index]
                target_pos = Position(target[0], target[1])
                
                dist = player.position.distance_to(target_pos)
                
                if dist < 0.1:
                    # Reached node
                    player.current_path_index += 1
                    if player.current_path_index >= len(player.path):
                        player.path = [] # Arrived
                        player.status_message = "Idle"
                else:
                    # Move towards target
                    dx = target_pos.x - player.position.x
                    dy = target_pos.y - player.position.y
                    
                    # Normalize
                    length = math.sqrt(dx*dx + dy*dy)
                    if length > 0:
                        dx /= length
                        dy /= length
                        
                        move_dist = player.speed * delta_time
                        
                        # Don't overshoot
                        if move_dist > dist:
                            move_dist = dist
                            
                        player.position.x += dx * move_dist
                        player.position.y += dy * move_dist
                        
                        # Update facing
                        player.facing_angle = math.atan2(dy, dx)
            
            # Debug log occasionally
            if random.random() < 0.01:
               logging.info(f"Physics heartbeat. Moving: {moving_count}. Delta: {delta_time:.4f}")

    def get_player_room(self, player_name: str) -> Optional[str]:
        player = self.players.get(player_name)
        if not player:
            return None
        
        p = player.position.to_point()
        for room in self.map.rooms.values():
            if room.bounds.contains(p):
                return room.name
        return "Hallway"

    def get_nearby_players(self, player_name: str, radius: float = 10.0) -> List[str]:
        player = self.players.get(player_name)
        if not player:
            return []
            
        nearby = []
        for other_name, other in self.players.items():
            if other_name != player_name and other.is_alive:
                dist = player.position.distance_to(other.position)
                if dist <= radius:
                    nearby.append(other_name)
        return nearby

    def get_available_tasks(self, player_name: str) -> List[str]:
        # Return list of task descriptions at current location
        player = self.players.get(player_name)
        if not player:
            return []
            
        p = player.position.to_point()
        available = []
        
        # Check if near any task location
        for task in self.map.tasks.values():
            # Simple distance check to task location
            dx = p.x - task.position.x
            dy = p.y - task.position.y
            if dx*dx + dy*dy < 4: # Within 2 units
                available.append(task.description)
                
        return available
