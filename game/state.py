"""Game state management for Among Us."""
import math
import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple
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
class PlayerState:
    """State of a single player/agent."""
    name: str
    position: Position
    is_imposter: bool
    is_alive: bool = True
    tasks_completed: Set[str] = field(default_factory=set)
    total_tasks: int = 3
    last_action: Optional[str] = None
    suspicion_levels: Dict[str, int] = field(default_factory=dict)  # player_name -> suspicion (0-10)
    is_in_vent: bool = False
    current_vent: Optional[str] = None
    
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
        self.dead_bodies: List[Tuple[str, Position]] = []  # (player_name, position)
        self.current_turn: int = 0
        self.meeting_called_by: Optional[str] = None
        self.votes: Dict[str, str] = {}
        
        # Map
        self.map = SpaceshipMap()
        
        # Config
        self.config = {
            'render_movement_speed': 10.0, # Grid units per second
        }
        
    def add_player(self, name: str, is_imposter: bool, color: Tuple[int, int, int]):
        """Add a player to the game."""
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
        
    def update_animations(self, delta_time: float):
        """Update player render positions based on animation state."""
        for player in self.players.values():
            if player.render_target:
                player.animation_timer += delta_time
                t = min(1.0, player.animation_timer / player.animation_duration) if player.animation_duration > 0 else 1.0
                
                # Lerp
                new_x = player.render_start.x + (player.render_target.x - player.render_start.x) * t
                new_y = player.render_start.y + (player.render_target.y - player.render_start.y) * t
                player.render_position = Position(new_x, new_y)
                
                if t >= 1.0:
                    player.render_target = None
            else:
                # Sync if no animation
                player.render_position = Position(player.position.x, player.position.y)

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
