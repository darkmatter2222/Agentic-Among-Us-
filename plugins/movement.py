"""Movement plugin for Among Us game actions."""
from typing import Annotated
from semantic_kernel.functions import kernel_function


class MovementPlugin:
    """Plugin for player movement actions.
    
    Provides movement functions for agents including moving to coordinates,
    moving to specific rooms, and staying in place to observe.
    """
    
    def __init__(self, game_state) -> None:
        self.game_state = game_state
        self.player_name = None  # Set before each use
    
    @kernel_function(description="Move to a specific coordinate on the map")
    def move_to(
        self,
        x: Annotated[float, "X coordinate to move to"],
        y: Annotated[float, "Y coordinate to move to"]
    ) -> Annotated[str, "Result of the movement"]:
        """Move player to specific coordinates."""
        from game.state import Position
        
        if not self.player_name:
            return "Error: No player set for this action"
        
        # Limit movement distance per turn
        current_pos = self.game_state.players[self.player_name].position
        new_pos = Position(x, y)
        
        max_movement = 80.0  # Maximum distance per turn
        distance = current_pos.distance_to(new_pos)
        
        if distance > max_movement:
            # Move towards target but only max_movement distance
            ratio = max_movement / distance
            new_x = current_pos.x + (new_pos.x - current_pos.x) * ratio
            new_y = current_pos.y + (new_pos.y - current_pos.y) * ratio
            new_pos = Position(new_x, new_y)
        
        success = self.game_state.move_player(self.player_name, new_pos)
        
        if success:
            # Find which room player is in
            room_name = "hallway"
            for room in self.game_state.rooms.values():
                if room.contains(new_pos):
                    room_name = room.name
                    break
            return f"Moved to ({new_pos.x:.1f}, {new_pos.y:.1f}) in {room_name}"
        
        return "Movement failed"
    
    @kernel_function(description="Move to a specific room on the map")
    def move_to_room(
        self,
        room_name: Annotated[str, "Name of the room to move to (cafeteria, weapons, o2, navigation, shields, engines)"]
    ) -> Annotated[str, "Result of the movement"]:
        """Move player towards a named room."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        room_name_lower = room_name.lower()
        if room_name_lower not in self.game_state.rooms:
            return f"Unknown room: {room_name}"
        
        room = self.game_state.rooms[room_name_lower]
        return self.move_to(room.center.x, room.center.y)
    
    @kernel_function(description="Stay in current position and observe surroundings")
    def stay(self) -> Annotated[str, "Observation of current surroundings"]:
        """Stay in place and observe."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        player = self.game_state.players[self.player_name]
        visible = self.game_state.get_visible_players(self.player_name)
        nearby_tasks = self.game_state.get_nearby_tasks(self.player_name)
        
        # Find current room
        room_name = "hallway"
        for room in self.game_state.rooms.values():
            if room.contains(player.position):
                room_name = room.name
                break
        
        result = f"Staying in {room_name}. "
        
        if visible:
            result += f"Visible players: {', '.join(visible)}. "
        else:
            result += "No other players visible. "
        
        if nearby_tasks:
            task_names = [t.name for t in nearby_tasks]
            result += f"Nearby tasks: {', '.join(task_names)}."
        
        return result
