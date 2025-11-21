"""Agent manager for Among Us game."""
import random
from typing import List

from semantic_kernel import Kernel
from semantic_kernel.agents import ChatCompletionAgent
from semantic_kernel.connectors.ai import FunctionChoiceBehavior
from semantic_kernel.connectors.ai.prompt_execution_settings import PromptExecutionSettings
from semantic_kernel.functions import KernelArguments

from llama_client import LlamaCppChatCompletion
from plugins.movement import MovementPlugin
from plugins.tasks import TaskPlugin
from plugins.social import SocialPlugin, ImposterPlugin


class AgentManager:
    """Manages the 8 agents in the Among Us game.
    
    Handles agent creation, personality assignment, and action execution
    for both crewmates and imposters.
    """
    
    def __init__(self, game_state) -> None:
        self.game_state = game_state
        self.agents: dict[str, ChatCompletionAgent] = {}
        self.imposters: List[str] = []
        
        # Create plugins (will set player_name before each use)
        self.movement_plugin = MovementPlugin(game_state)
        self.task_plugin = TaskPlugin(game_state)
        self.social_plugin = SocialPlugin(game_state)
        self.imposter_plugin = ImposterPlugin(game_state)
        
    def create_agents(self):
        """Create 8 agents with 2 imposters."""
        player_names = [
            "Red", "Blue", "Green", "Yellow",
            "Purple", "Orange", "Pink", "Cyan"
        ]
        
        # Randomly select 2 imposters
        self.imposters = random.sample(player_names, 2)
        
        for name in player_names:
            is_imposter = name in self.imposters
            agent = self._create_agent(name, is_imposter)
            self.agents[name] = agent
        
        print(f"🎮 Created 8 agents")
        print(f"👿 Imposters: {', '.join(self.imposters)}")
        print(f"👥 Crewmates: {', '.join([n for n in player_names if n not in self.imposters])}")
    
    def _create_agent(self, name: str, is_imposter: bool) -> ChatCompletionAgent:
        """Create a single agent with appropriate instructions."""
        kernel = Kernel()
        kernel.add_service(LlamaCppChatCompletion())
        
        # Add plugins to kernel
        kernel.add_plugin(self.movement_plugin, "Movement")
        kernel.add_plugin(self.task_plugin, "Tasks")
        kernel.add_plugin(self.social_plugin, "Social")
        
        if is_imposter:
            kernel.add_plugin(self.imposter_plugin, "Imposter")
        
        # Configure function calling
        settings = PromptExecutionSettings()
        settings.function_choice_behavior = FunctionChoiceBehavior.Auto()
        
        # Create personality-specific instructions
        personality = self._get_personality(name)
        
        if is_imposter:
            instructions = f"""You are {name}, an IMPOSTER in Among Us.

PERSONALITY: {personality}

🎯 YOUR SECRET GOAL: Eliminate crewmates without being caught. You win when imposters equal or outnumber crewmates.

IMPOSTER ABILITIES:
- Kill nearby players when alone (use Imposter.kill) - cooldown: 5 turns
- Fake doing tasks to blend in (use Tasks.fake_task)
- Enter vents to hide and travel (use Imposter.enter_vent)
- Exit vents at connected locations (use Imposter.exit_vent)
- Trigger sabotages (use Imposter.sabotage: reactor, o2, lights, communications)
- Call meetings to deflect suspicion (use Social.call_meeting)
- YOU CANNOT actually complete real tasks (you're an imposter!)

SABOTAGE TACTICS:
- Reactor/O2: Forces crewmates to location, creates kill opportunities
- Lights: Reduces crewmate vision drastically (you still see normally)
- Communications: Disables task list, causes confusion

VENT NETWORK:
- Admin ↔ Cafeteria
- Electrical ↔ Security ↔ MedBay
- Navigation ↔ Shields
- Reactor ↔ Upper Engine ↔ Lower Engine

STRATEGY:
- Stay calm and act like a normal crewmate
- Fake task completion to build trust
- Kill only when no witnesses are around (check kill status first!)
- Use vents for quick escapes after kills
- Sabotage to create chaos and opportunities
- Create alibis by being seen in different rooms
- In meetings, deflect suspicion onto others
- Vote strategically to eliminate crewmates

IMPORTANT: Keep your imposter identity SECRET. Never reveal you're an imposter.

Available rooms: cafeteria, weapons, o2, navigation, shields, admin, storage, medbay, security, upper_engine, reactor, lower_engine, electrical, communications

Each turn, decide ONE action using the available functions. Think strategically!
"""
        else:
            instructions = f"""You are {name}, a CREWMATE in Among Us.

PERSONALITY: {personality}

🎯 YOUR GOAL: Complete all tasks OR identify and vote out the imposters. There are 2 imposters among the 8 players.

CREWMATE ABILITIES:
- Complete tasks around the map (use Tasks.complete_task)
- Fix sabotages when they occur (use Tasks.fix_sabotage)
- Call emergency meetings if suspicious (use Social.call_meeting)
- Report dead bodies you find (use Social.report_body)
- Vote to eject suspected imposters during meetings (use Social.vote)

RECOGNIZING IMPOSTERS:
- Faking tasks (standing near tasks but not completing)
- Following you in empty areas
- Appearing suddenly from unexpected locations (vents)
- Being near dead bodies without reporting
- Lying about locations or tasks

SABOTAGE RESPONSE:
- Reactor/O2: Critical! Must fix immediately in that room or everyone loses
- Lights: Your vision is reduced - stick with groups
- Communications: Task list disabled - remember what you were doing

STRATEGY:
- Complete your 3 tasks efficiently
- Pay attention to other players' behavior
- Watch for suspicious activity
- Report bodies immediately if found
- Fix critical sabotages (reactor, O2) immediately
- In meetings, share what you observed
- Vote based on evidence and behavior
- Stick with groups when possible (safety in numbers)

Available rooms: cafeteria, weapons, o2, navigation, shields, admin, storage, medbay, security, upper_engine, reactor, lower_engine, electrical, communications

Each turn, decide ONE action using the available functions. Stay alert!
"""
        
        agent = ChatCompletionAgent(
            kernel=kernel,
            name=name,
            instructions=instructions,
            arguments=KernelArguments(settings=settings)
        )
        
        return agent
    
    def _get_personality(self, name: str) -> str:
        """Get a unique personality for each agent."""
        personalities = {
            "Red": "Confident and outspoken, quick to accuse others",
            "Blue": "Analytical and calm, prefers evidence over emotion",
            "Green": "Nervous and suspicious, sees threats everywhere",
            "Yellow": "Friendly and trusting, gives others benefit of doubt",
            "Purple": "Strategic and quiet, observes before acting",
            "Orange": "Impulsive and reactive, makes quick decisions",
            "Pink": "Social and chatty, loves to discuss with others",
            "Cyan": "Methodical and task-focused, sticks to the plan"
        }
        return personalities.get(name, "Balanced and rational")
    
    async def get_agent_action(self, agent_name: str, context: str) -> str:
        """Get an action decision from an agent."""
        if agent_name not in self.agents:
            return "Agent not found"
        
        # Set player name in all plugins
        self.movement_plugin.player_name = agent_name
        self.task_plugin.player_name = agent_name
        self.social_plugin.player_name = agent_name
        self.imposter_plugin.player_name = agent_name
        
        agent = self.agents[agent_name]
        
        try:
            # Get agent's decision with context (invoke returns async generator)
            response_generator = agent.invoke(input=context)
            
            # Collect all streaming responses
            full_response = ""
            async for response in response_generator:
                if hasattr(response, 'content') and response.content:
                    full_response += str(response.content)
            
            return full_response if full_response else "No response"
        except Exception as e:
            import traceback
            error_details = traceback.format_exc()
            print(f"    Full error: {error_details}")
            return f"Error: {str(e)}"
