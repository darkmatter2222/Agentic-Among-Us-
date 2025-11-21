"""Task plugin for Among Us game actions."""
from typing import Annotated
from semantic_kernel.functions import kernel_function


class TaskPlugin:
    """Plugin for task-related actions.
    
    Provides functions for completing tasks (crewmates only),
    faking tasks (imposters), and checking task status.
    """
    
    def __init__(self, game_state) -> None:
        self.game_state = game_state
        self.player_name = None  # Set before each use
    
    @kernel_function(description="Complete a task if you are near it. Only crewmates can complete tasks.")
    def complete_task(
        self,
        task_name: Annotated[str, "Name of the task to complete"]
    ) -> Annotated[str, "Result of task completion attempt"]:
        """Attempt to complete a nearby task."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        player = self.game_state.players[self.player_name]
        
        if player.is_imposter:
            return "Imposters cannot complete tasks (but you can pretend to do them)"
        
        # Find task by name
        task = None
        for t in self.game_state.tasks.values():
            if task_name.lower() in t.name.lower():
                task = t
                break
        
        if not task:
            return f"Task '{task_name}' not found"
        
        if task.completed:
            return f"Task '{task.name}' already completed"
        
        # Check if near task
        distance = player.position.distance_to(task.position)
        if distance > 50.0:
            return f"Too far from task '{task.name}' (distance: {distance:.1f})"
        
        success = self.game_state.complete_task(self.player_name, task.id)
        
        if success:
            completed = len(player.tasks_completed)
            total = player.total_tasks
            return f"Completed task: {task.name} ({completed}/{total} tasks done)"
        
        return f"Failed to complete task: {task.name}"
    
    @kernel_function(description="Pretend to do a task (useful for imposters to blend in)")
    def fake_task(
        self,
        task_name: Annotated[str, "Name of the task to pretend to do"]
    ) -> Annotated[str, "Result of pretending to do task"]:
        """Pretend to do a task (doesn't actually complete it)."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        player = self.game_state.players[self.player_name]
        player.last_action = f"appeared to work on task: {task_name}"
        
        return f"Pretended to work on: {task_name}"
    
    @kernel_function(description="Check your task progress and which tasks are nearby")
    def check_tasks(self) -> Annotated[str, "Your task status"]:
        """Check task completion status."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        player = self.game_state.players[self.player_name]
        nearby = self.game_state.get_nearby_tasks(self.player_name, max_distance=100.0)
        
        if player.is_imposter:
            task_list = [f"{t.name} in {t.room}" for t in nearby[:3]]
            return f"You are an IMPOSTER (others don't know). Nearby tasks you could fake: {', '.join(task_list) if task_list else 'none nearby'}"
        
        completed = len(player.tasks_completed)
        total = player.total_tasks
        
        result = f"Tasks completed: {completed}/{total}. "
        
        if nearby:
            task_list = [f"{t.name} in {t.room}" for t in nearby]
            result += f"Nearby tasks: {', '.join(task_list)}"
        else:
            result += "No tasks nearby. Move to find tasks."
        
        return result
    
    @kernel_function(description="Fix an active sabotage (reactor, O2, lights, communications)")
    def fix_sabotage(self) -> Annotated[str, "Result of fixing sabotage"]:
        """Attempt to fix active sabotage."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        if not self.game_state.active_sabotage:
            return "No sabotage currently active"
        
        success = self.game_state.fix_sabotage(self.player_name)
        
        if success:
            return "Fixed sabotage!"
        
        sabotage_type = self.game_state.active_sabotage.sabotage_type.value
        return f"Cannot fix {sabotage_type} from here. Go to the {sabotage_type} room to fix it."

