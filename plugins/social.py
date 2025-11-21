"""Social and imposter plugins for Among Us game actions."""
from typing import Annotated
from semantic_kernel.functions import kernel_function


class SocialPlugin:
    """Plugin for social actions like meetings and voting.
    
    Provides functions for calling emergency meetings, reporting bodies,
    and casting votes during voting phases.
    """
    
    def __init__(self, game_state) -> None:
        self.game_state = game_state
        self.player_name = None
    
    @kernel_function(description="Call an emergency meeting to discuss suspicious activity")
    def call_meeting(
        self,
        reason: Annotated[str, "Why you're calling the meeting"] = "emergency"
    ) -> Annotated[str, "Result of calling meeting"]:
        """Call an emergency meeting."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        success = self.game_state.call_meeting(self.player_name)
        
        if success:
            return f"Emergency meeting called! Reason: {reason}"
        
        return "Cannot call meeting right now"
    
    @kernel_function(description="Report a dead body you discovered")
    def report_body(
        self,
        player_name: Annotated[str, "Name of the dead player"]
    ) -> Annotated[str, "Result of reporting body"]:
        """Report finding a dead body."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        # Check if there's a body nearby
        reporter = self.game_state.players[self.player_name]
        body_found = False
        
        for dead_player, body_pos in self.game_state.dead_bodies:
            if dead_player == player_name and reporter.position.distance_to(body_pos) < 50.0:
                body_found = True
                break
        
        if not body_found:
            return f"No body of {player_name} found nearby"
        
        success = self.game_state.call_meeting(self.player_name)
        
        if success:
            return f"Reported {player_name}'s body! Meeting started."
        
        return "Failed to report body"
    
    @kernel_function(description="Vote to eject a player during voting phase")
    def vote(
        self,
        player_name: Annotated[str, "Name of player to vote for, or 'skip' to skip vote"]
    ) -> Annotated[str, "Result of vote"]:
        """Cast vote during voting phase."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        success = self.game_state.cast_vote(self.player_name, player_name)
        
        if success:
            return f"Voted for: {player_name}"
        
        return "Cannot vote right now"


class ImposterPlugin:
    """Plugin for imposter-only actions.
    
    Provides kill functionality and kill status checking for imposters.
    Enforces cooldowns and line-of-sight requirements.
    """
    
    def __init__(self, game_state) -> None:
        self.game_state = game_state
        self.player_name = None
    
    @kernel_function(description="IMPOSTER ONLY: Kill a nearby player. Use when alone with target.")
    def kill(
        self,
        target_name: Annotated[str, "Name of player to kill"]
    ) -> Annotated[str, "Result of kill attempt"]:
        """Kill a target player (imposter only)."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        player = self.game_state.players[self.player_name]
        
        if not player.is_imposter:
            return "You are not an imposter!"
        
        # Check cooldown
        if self.game_state.kill_cooldown.get(self.player_name, 0) > 0:
            turns_left = self.game_state.kill_cooldown[self.player_name]
            return f"Kill on cooldown for {turns_left} more turns"
        
        # Check if target exists and is alive
        if target_name not in self.game_state.players:
            return f"Player {target_name} not found"
        
        target = self.game_state.players[target_name]
        if not target.is_alive:
            return f"{target_name} is already dead"
        
        # Check distance
        distance = player.position.distance_to(target.position)
        if distance > 30.0:
            return f"Too far from {target_name} (distance: {distance:.1f}, need < 30)"
        
        # Check if others are watching
        visible_players = self.game_state.get_visible_players(self.player_name)
        witnesses = [p for p in visible_players if p != target_name]
        
        if witnesses:
            return f"Cannot kill - witnesses present: {', '.join(witnesses)}"
        
        success = self.game_state.kill_player(self.player_name, target_name)
        
        if success:
            return f"Successfully killed {target_name}. Kill cooldown activated."
        
        return f"Failed to kill {target_name}"
    
    @kernel_function(description="IMPOSTER ONLY: Check kill cooldown and nearby targets")
    def check_kill_status(self) -> Annotated[str, "Current kill availability"]:
        """Check if kill is available."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        player = self.game_state.players[self.player_name]
        
        if not player.is_imposter:
            return "You are not an imposter!"
        
        cooldown = self.game_state.kill_cooldown.get(self.player_name, 0)
        
        if cooldown > 0:
            return f"Kill on cooldown for {cooldown} turns"
        
        # Find nearby players
        nearby = []
        for other_name, other in self.game_state.players.items():
            if other_name != self.player_name and other.is_alive:
                distance = player.position.distance_to(other.position)
                if distance < 50.0:
                    nearby.append(f"{other_name} ({distance:.1f} units away)")
        
        if nearby:
            return f"Kill ready! Nearby players: {', '.join(nearby)}"
        
        return "Kill ready! No players nearby."
    
    @kernel_function(description="IMPOSTER ONLY: Enter a nearby vent to hide and travel")
    def enter_vent(self) -> Annotated[str, "Result of entering vent"]:
        """Enter a vent to hide."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        player = self.game_state.players[self.player_name]
        
        if not player.is_imposter:
            return "You are not an imposter!"
        
        if player.is_in_vent:
            return "Already in a vent!"
        
        success = self.game_state.enter_vent(self.player_name)
        
        if success:
            # Show connected vents
            if self.game_state.map_layout and player.current_vent:
                connected = self.game_state.map_layout.vents.get(player.current_vent, [])
                if connected:
                    return f"Entered vent in {player.current_vent}. Can travel to: {', '.join(connected)}"
            return f"Entered vent in {player.current_vent}"
        
        return "No vent nearby to enter"
    
    @kernel_function(description="IMPOSTER ONLY: Exit vent, optionally travel to connected vent first")
    def exit_vent(
        self,
        target_room: Annotated[str, "Optional: room name to travel to before exiting"] = ""
    ) -> Annotated[str, "Result of exiting vent"]:
        """Exit vent, optionally after traveling."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        player = self.game_state.players[self.player_name]
        
        if not player.is_imposter:
            return "You are not an imposter!"
        
        if not player.is_in_vent:
            return "Not in a vent!"
        
        target = target_room.lower() if target_room else None
        success = self.game_state.exit_vent(self.player_name, target)
        
        if success:
            return f"Exited vent"
        
        return "Failed to exit vent"
    
    @kernel_function(description="IMPOSTER ONLY: Trigger a sabotage (reactor, o2, lights, communications)")
    def sabotage(
        self,
        sabotage_type: Annotated[str, "Type of sabotage: reactor, o2, lights, or communications"]
    ) -> Annotated[str, "Result of sabotage"]:
        """Trigger a sabotage."""
        if not self.player_name:
            return "Error: No player set for this action"
        
        player = self.game_state.players[self.player_name]
        
        if not player.is_imposter:
            return "You are not an imposter!"
        
        from game.state import SabotageType
        
        sabotage_map = {
            "reactor": SabotageType.REACTOR,
            "o2": SabotageType.O2,
            "lights": SabotageType.LIGHTS,
            "communications": SabotageType.COMMUNICATIONS,
            "comms": SabotageType.COMMUNICATIONS,
        }
        
        sab_type = sabotage_map.get(sabotage_type.lower())
        
        if not sab_type:
            return f"Unknown sabotage type: {sabotage_type}. Use: reactor, o2, lights, or communications"
        
        if self.game_state.active_sabotage:
            return f"Sabotage already active: {self.game_state.active_sabotage.sabotage_type.value}"
        
        if self.game_state.sabotage_cooldown > 0:
            return f"Sabotage on cooldown for {self.game_state.sabotage_cooldown} turns"
        
        success = self.game_state.trigger_sabotage(sab_type, self.player_name)
        
        if success:
            effects = {
                SabotageType.REACTOR: "Reactor meltdown! Crewmates must fix in reactor room or lose!",
                SabotageType.O2: "Oxygen depleting! Crewmates must fix in O2 room or lose!",
                SabotageType.LIGHTS: "Lights out! Crewmate vision severely reduced.",
                SabotageType.COMMUNICATIONS: "Communications down! Crewmates can't see task list.",
            }
            return f"Triggered {sabotage_type} sabotage! {effects.get(sab_type, '')}"
        
        return "Failed to trigger sabotage"

