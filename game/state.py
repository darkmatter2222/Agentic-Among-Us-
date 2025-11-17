"""Game state management for Among Us."""
from dataclasses import dataclass, field
from typing import List, Dict, Set, Optional, Tuple
from enum import Enum
import math


class GamePhase(Enum):
    """Current phase of the game."""
    PLAYING = "playing"
    MEETING = "meeting"
    VOTING = "voting"
    GAME_OVER = "game_over"


@dataclass
class Position:
    """2D position on the map."""
    x: float
    y: float
    
    def distance_to(self, other: 'Position') -> float:
        """Calculate Euclidean distance to another position."""
        return math.sqrt((self.x - other.x)**2 + (self.y - other.y)**2)
    
    def to_tuple(self) -> Tuple[float, float]:
        return (self.x, self.y)


@dataclass
class Task:
    """A task that crewmates must complete."""
    id: str
    name: str
    position: Position
    room: str
    completed: bool = False
    assigned_to: Optional[str] = None


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


@dataclass
class Room:
    """A room on the map."""
    name: str
    center: Position
    width: float
    height: float
    
    def contains(self, pos: Position) -> bool:
        """Check if a position is inside this room."""
        return (abs(pos.x - self.center.x) <= self.width / 2 and
                abs(pos.y - self.center.y) <= self.height / 2)


class GameState:
    """Manages the entire game state."""
    
    def __init__(self):
        self.phase = GamePhase.PLAYING
        self.players: Dict[str, PlayerState] = {}
        self.tasks: Dict[str, Task] = {}
        self.rooms: Dict[str, Room] = {}
        self.dead_bodies: List[Tuple[str, Position]] = []  # (player_name, position)
        self.current_turn: int = 0
        self.vision_range: float = 150.0
        self.kill_cooldown: Dict[str, int] = {}  # imposter_name -> turns until can kill
        self.meeting_called_by: Optional[str] = None
        self.votes: Dict[str, str] = {}  # voter_name -> voted_for_name
        
    def initialize_map(self):
        """Create the map layout with rooms."""
        # Simple map with 6 rooms
        self.rooms = {
            "cafeteria": Room("Cafeteria", Position(200, 200), 150, 150),
            "weapons": Room("Weapons", Position(100, 400), 120, 100),
            "o2": Room("O2", Position(400, 400), 100, 100),
            "navigation": Room("Navigation", Position(600, 300), 120, 100),
            "shields": Room("Shields", Position(600, 100), 100, 100),
            "engines": Room("Engines", Position(200, 500), 140, 120),
        }
        
    def initialize_tasks(self):
        """Create tasks in various rooms."""
        task_definitions = [
            ("task_cafe_1", "Download Data", "cafeteria"),
            ("task_cafe_2", "Empty Garbage", "cafeteria"),
            ("task_weap_1", "Clear Asteroids", "weapons"),
            ("task_o2_1", "Clean O2 Filter", "o2"),
            ("task_nav_1", "Chart Course", "navigation"),
            ("task_nav_2", "Fix Wiring", "navigation"),
            ("task_shield_1", "Prime Shields", "shields"),
            ("task_engine_1", "Align Engine Output", "engines"),
            ("task_engine_2", "Fuel Engines", "engines"),
        ]
        
        for task_id, name, room in task_definitions:
            room_obj = self.rooms[room]
            self.tasks[task_id] = Task(
                id=task_id,
                name=name,
                position=Position(room_obj.center.x, room_obj.center.y),
                room=room
            )
    
    def add_player(self, name: str, is_imposter: bool, spawn_position: Position):
        """Add a player to the game."""
        self.players[name] = PlayerState(
            name=name,
            position=spawn_position,
            is_imposter=is_imposter
        )
        if is_imposter:
            self.kill_cooldown[name] = 0
    
    def get_visible_players(self, observer_name: str) -> List[str]:
        """Get list of players visible to the observer."""
        if observer_name not in self.players:
            return []
        
        observer = self.players[observer_name]
        if not observer.is_alive:
            return []
        
        visible = []
        for player_name, player in self.players.items():
            if player_name == observer_name or not player.is_alive:
                continue
            
            distance = observer.position.distance_to(player.position)
            if distance <= self.vision_range:
                # Check if in same room or line of sight
                if self._has_line_of_sight(observer.position, player.position):
                    visible.append(player_name)
        
        return visible
    
    def _has_line_of_sight(self, pos1: Position, pos2: Position) -> bool:
        """Simple line of sight - same room or close proximity."""
        # For simplicity, just check distance
        return pos1.distance_to(pos2) <= self.vision_range
    
    def get_nearby_tasks(self, player_name: str, max_distance: float = 50.0) -> List[Task]:
        """Get tasks near a player."""
        if player_name not in self.players:
            return []
        
        player = self.players[player_name]
        nearby = []
        
        for task in self.tasks.values():
            if not task.completed and player.position.distance_to(task.position) <= max_distance:
                nearby.append(task)
        
        return nearby
    
    def move_player(self, player_name: str, new_position: Position) -> bool:
        """Move a player to a new position."""
        if player_name not in self.players:
            return False
        
        player = self.players[player_name]
        if not player.is_alive:
            return False
        
        # Simple movement - just update position
        player.position = new_position
        player.last_action = f"moved to {new_position.to_tuple()}"
        return True
    
    def complete_task(self, player_name: str, task_id: str) -> bool:
        """Complete a task."""
        if player_name not in self.players or task_id not in self.tasks:
            return False
        
        player = self.players[player_name]
        task = self.tasks[task_id]
        
        if player.is_imposter or not player.is_alive or task.completed:
            return False
        
        # Check if player is near the task
        if player.position.distance_to(task.position) > 50.0:
            return False
        
        task.completed = True
        player.tasks_completed.add(task_id)
        player.last_action = f"completed task: {task.name}"
        return True
    
    def kill_player(self, imposter_name: str, target_name: str) -> bool:
        """Imposter kills a target player."""
        if imposter_name not in self.players or target_name not in self.players:
            return False
        
        imposter = self.players[imposter_name]
        target = self.players[target_name]
        
        if not imposter.is_imposter or not imposter.is_alive:
            return False
        
        if not target.is_alive:
            return False
        
        # Check cooldown
        if self.kill_cooldown.get(imposter_name, 0) > 0:
            return False
        
        # Check distance
        if imposter.position.distance_to(target.position) > 30.0:
            return False
        
        # Kill the target
        target.is_alive = False
        self.dead_bodies.append((target_name, Position(target.position.x, target.position.y)))
        self.kill_cooldown[imposter_name] = 5  # 5 turn cooldown
        imposter.last_action = f"killed {target_name}"
        return True
    
    def call_meeting(self, caller_name: str) -> bool:
        """Call an emergency meeting."""
        if self.phase != GamePhase.PLAYING:
            return False
        
        if caller_name not in self.players:
            return False
        
        player = self.players[caller_name]
        if not player.is_alive:
            return False
        
        self.phase = GamePhase.MEETING
        self.meeting_called_by = caller_name
        self.votes = {}
        return True
    
    def cast_vote(self, voter_name: str, voted_for: str) -> bool:
        """Cast a vote during voting phase."""
        if self.phase != GamePhase.VOTING:
            return False
        
        if voter_name not in self.players:
            return False
        
        voter = self.players[voter_name]
        if not voter.is_alive:
            return False
        
        self.votes[voter_name] = voted_for
        return True
    
    def tally_votes(self) -> Optional[str]:
        """Count votes and return player to eliminate (or None for tie/skip)."""
        if not self.votes:
            return None
        
        vote_counts: Dict[str, int] = {}
        for voted_for in self.votes.values():
            vote_counts[voted_for] = vote_counts.get(voted_for, 0) + 1
        
        # Find player with most votes
        max_votes = max(vote_counts.values())
        players_with_max = [p for p, v in vote_counts.items() if v == max_votes]
        
        # If tie, nobody is eliminated
        if len(players_with_max) > 1:
            return None
        
        return players_with_max[0]
    
    def eliminate_player(self, player_name: str):
        """Eliminate a player from the game."""
        if player_name in self.players:
            self.players[player_name].is_alive = False
    
    def check_win_condition(self) -> Optional[str]:
        """Check if game is over. Returns 'crewmates', 'imposters', or None."""
        alive_crewmates = sum(1 for p in self.players.values() if p.is_alive and not p.is_imposter)
        alive_imposters = sum(1 for p in self.players.values() if p.is_alive and p.is_imposter)
        
        # Imposters win if equal or more than crewmates
        if alive_imposters >= alive_crewmates:
            return "imposters"
        
        # Crewmates win if all imposters dead
        if alive_imposters == 0:
            return "crewmates"
        
        # Crewmates win if all tasks complete
        all_tasks_done = all(task.completed for task in self.tasks.values())
        if all_tasks_done:
            return "crewmates"
        
        return None
    
    def update_cooldowns(self):
        """Decrease kill cooldowns."""
        for imposter in self.kill_cooldown:
            if self.kill_cooldown[imposter] > 0:
                self.kill_cooldown[imposter] -= 1
