# Among Us - AI Agent Game 🎮

An AI-powered Among Us simulation where 8 agents play the game autonomously using Semantic Kernel and llama.cpp for decision-making.

## Overview

This project simulates an Among Us game with 8 AI agents (6 crewmates and 2 imposters). Each agent has a unique personality and uses function calling to interact with the game world through natural language reasoning.

## Features

- **8 AI Agents**: Each with unique personalities (Red, Blue, Green, Yellow, Purple, Orange, Pink, Cyan)
- **2 Secret Imposters**: Randomly selected each game
- **Autonomous Decision Making**: Agents use llama.cpp for natural language reasoning
- **Function Calling**: Agents can move, complete tasks, call meetings, vote, and kill (imposters)
- **Visual Game Interface**: Real-time pygame visualization showing:
  - Map with 6 rooms (Cafeteria, Weapons, O2, Navigation, Shields, Engines)
  - Player positions and movements
  - Task locations and completion status
  - Dead bodies
  - Game statistics and player info

## Project Structure

```
agentrunner/
├── amongus_game.py           # Main game loop and entry point
├── llama_client.py            # Custom llama.cpp client for Semantic Kernel
├── agents/
│   ├── __init__.py
│   └── agent_manager.py       # Agent creation and management
├── game/
│   ├── __init__.py
│   └── state.py               # Game state management
├── plugins/
│   ├── __init__.py
│   ├── movement.py            # Movement functions for agents
│   ├── tasks.py               # Task completion functions
│   └── social.py              # Meeting, voting, and kill functions
└── ui/
    ├── __init__.py
    └── renderer.py            # Pygame rendering
```

## Requirements

- Python 3.10+
- llama.cpp server running (default: `http://192.168.86.48:8080`)
- Required packages (see `requirements.txt`)

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Set up and run a llama.cpp server:
   - Follow instructions at [llama.cpp](https://github.com/ggerganov/llama.cpp)
   - Update the base URL in `llama_client.py` if needed
4. Run the game:
   ```bash
   python amongus_game.py
   ```

## How It Works

### Agent Decision Making

Each agent receives context about their surroundings and makes decisions using natural language:
- Current position and room
- Visible players
- Nearby tasks
- Task completion status (crewmates) or kill cooldown (imposters)

Agents use Semantic Kernel's function calling to execute actions through plugins:
- **Movement**: `move_to()`, `move_to_room()`, `stay()`
- **Tasks**: `complete_task()`, `fake_task()`, `check_tasks()`
- **Social**: `call_meeting()`, `report_body()`, `vote()`
- **Imposter**: `kill()`, `check_kill_status()`

### Agent Personalities

Each agent has a unique personality that influences their decision-making:
- **Red**: Confident and outspoken, quick to accuse
- **Blue**: Analytical and calm, prefers evidence
- **Green**: Nervous and suspicious
- **Yellow**: Friendly and trusting
- **Purple**: Strategic and quiet
- **Orange**: Impulsive and reactive
- **Pink**: Social and chatty
- **Cyan**: Methodical and task-focused

### Win Conditions

**Crewmates win if**:
- All imposters are voted out
- All tasks are completed

**Imposters win if**:
- Imposters equal or outnumber crewmates

## Game Controls

- The game runs automatically with agents making decisions
- Close the window or press ESC to exit
- Game ends after 100 turns or when a win condition is met

## Configuration

Edit `llama_client.py` to change the llama.cpp server URL:
```python
def __init__(self, base_url: str = "http://YOUR_SERVER:8080", ...):
```

## Technical Details

- **Game Loop**: Turn-based, each agent acts once per round
- **Vision Range**: 150 units (agents can see nearby players and tasks)
- **Kill Range**: 30 units (imposters must be close to kill)
- **Kill Cooldown**: 5 turns after each kill
- **Movement Speed**: Max 80 units per turn
- **Task Range**: 50 units to complete a task

## Known Issues

- Meeting and voting systems are defined but not fully integrated into the game loop
- Dead bodies are tracked but agents don't actively search for them
- Chat/discussion during meetings is not implemented

## Future Improvements

- [ ] Implement full meeting and voting mechanics
- [ ] Add agent memory and suspicion tracking
- [ ] Implement emergency tasks and sabotages
- [ ] Add audio/visual effects for kills and meetings
- [ ] Create agent chat logs during meetings
- [ ] Add replay functionality

## License

This is a demo/educational project. Among Us is a trademark of Innersloth LLC.

## Contributing

Feel free to open issues or submit pull requests with improvements!
