# Agentic Among Us - Upgrade Implementation Plan

## 1. Architecture & Concurrency
**Goal:** Run 8 independent agent threads while maintaining a smooth 60 FPS render loop.

*   **Main Thread (UI/Game Loop)**:
    *   Handles Pygame rendering.
    *   Updates animations (interpolation between grid points).
    *   Processes user input (camera control, manual overrides).
    *   Broadcasting "Global Events" (e.g., Meeting Started).
*   **Agent Threads (x8)**:
    *   Each agent runs in its own `threading.Thread`.
    *   Loop: `Observe` -> `Decide (LLM/Rule)` -> `Act`.
    *   **Synchronization**: Use `threading.Lock` for accessing `GameState` to prevent race conditions.
*   **Event Bus**:
    *   A thread-safe message queue system.
    *   Events: `PlayerMoved`, `TaskCompleted`, `BodyReported`, `MeetingCalled`, `PlayerKilled`.

## 2. Advanced Movement & Pathfinding
**Goal:** Natural, non-robotic movement with obstacle avoidance.

*   **A* Pathfinding**:
    *   Implement A* algorithm on the `SpaceshipMap` grid (0=walkable, 1=wall).
    *   Cache paths for static map geometry if performance is an issue.
*   **Path Smoothing**:
    *   Instead of moving center-to-center of tiles (zig-zag), use **String Pulling** or **Spline Interpolation** to create curved paths.
    *   Implement a `MovementController` that handles velocity, acceleration, and turning radius.
*   **Collision Avoidance**:
    *   Simple separation steering behavior to prevent agents from stacking on top of each other perfectly.

## 3. Game Mechanics (Rules of Among Us)
**Goal:** Full feature parity with the core game loop.

*   **Crewmates**:
    *   **Tasks**:
        *   Assign random tasks from `TaskLocation` list at start.
        *   Agents must travel to exact coordinates.
        *   "Performing" a task takes time (e.g., 3-10 seconds).
        *   Visual indicator (progress bar) in sidebar.
    *   **Vision**:
        *   Agents can only "see" other players within their raycast polygon.
        *   Fog of War logic for agent memory ("I saw Red in Medbay 5s ago").
*   **Imposters**:
    *   **Kill**:
        *   Check distance (< 1.5 units).
        *   Check Cooldown (e.g., 30s).
        *   Action: Instantly turns target to `DEAD`, leaves a body.
    *   **Vent**:
        *   Can enter vent if close.
        *   Teleport to connected vent nodes.
        *   Invisible while in vent.
    *   **Sabotage**:
        *   Trigger map-wide crises (Lights, Reactor, O2).
*   **Game Flow**:
    *   **Body Discovery**:
        *   If a player sees a dead body (within vision), they trigger `Report`.
    *   **Emergency Meetings**:
        *   Teleport all players to Cafeteria.
        *   Pause game simulation.
        *   Enter `VotingPhase`.

## 4. LLM "Brain" & Event-Driven Decisions
**Goal:** Reduce API costs/latency by only calling LLM when necessary.

*   **Observation System**:
    *   Construct a text prompt based on *current* sensory data.
    *   *Example*: "You are in Admin. You see Red (Dead Body). You see Blue nearby."
*   **Trigger-Based Decisions**:
    *   **Idle**: "I finished my task. Where should I go next?" -> LLM Call.
    *   **Event**: "I just saw a murder!" -> Immediate Priority Action (Report/Run).
    *   **Proximity**: "I am near Green. Should I talk/sus them?" -> Low probability check.
*   **Memory Stream**:
    *   Keep a short history of observations: "Saw Red in Elec", "Did wiring task".
    *   Pass this context to the LLM during meetings.

## 5. Implementation Phases

### Phase 1: Core Systems Refactor
1.  Create `ThreadedAgent` class.
2.  Implement `ThreadSafeGameState` wrapper.
3.  Replace random movement loop with `AgentManager` starting threads.

### Phase 2: Pathfinding & Physics
1.  Implement `Pathfinder` module (A*).
2.  Update `MovementPlugin` to use pathfinding.
3.  Add "Physics" update step in main loop for smooth interpolation.

### Phase 3: Mechanics & Rules
1.  Implement `TaskManager` (assigning/tracking).
2.  Implement `Kill` and `Report` actions.
3.  Implement `VisionSystem` (checking line-of-sight for agents).

### Phase 4: The "Brain" (LLM Integration)
1.  Design the `PromptBuilder`.
2.  Connect `LlamaClient` to the threaded agents.
3.  Implement the `Meeting` phase (chat history, voting logic).

## 6. Immediate Next Steps
1.  Refactor `amongus_game.py` to initialize the `AgentManager` and start threads.
2.  Implement the A* pathfinding in a new `game/pathfinding.py` module.