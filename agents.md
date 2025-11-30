# Among Us Game Mechanics - Complete Reference for AI Agents

> **Note**: This document describes the full Among Us game mechanics. See the [Implementation Status](#implementation-status) section at the end for what is currently active in this simulation.

---

## Document Maintenance Requirements

**IMPORTANT**: When making ANY changes to the codebase, AI agents MUST update this document (`agents.md`) to reflect those changes. This includes:

- Adding new features to the [Implementation Status](#implementation-status) section
- Moving features from "Not Yet Implemented" to "Fully Implemented" when completed
- Updating configuration values if they change
- Adding new AI decision types or thought triggers
- Documenting any new systems, renderers, or mechanics

**This document is the source of truth for what the simulation can and cannot do.** Keeping it accurate ensures future AI agents can work effectively.

---

## Development Notes & Do's/Don'ts

### DON'T DO

1. **DO NOT stop or start the server** when making changes to this document, reviewing issues, or debugging. The simulation runs continuously and server restarts will disrupt live testing.

2. **DO NOT stop or start the client** unless explicitly instructed by the user. Hot module replacement handles most changes.

3. **DO NOT restart services to "test" changes** - this disrupts live observation and debugging sessions.

4. **DO NOT modify `docker-manage/` scripts without user consent** - these control the LLM infrastructure.

5. **DO NOT delete or overwrite map data files** (`shared/data/`) without backup.

6. **DO NOT change WebSocket port configurations** without updating all dependent files.

### DO

1. **DO update this `agents.md` file** whenever you make changes to the codebase.

2. **DO check the Implementation Status section** before implementing features - it may already exist.

3. **DO use the existing type system** in `shared/types/` for new features.

4. **DO follow the existing code patterns** in `shared/engine/` for game logic.

5. **DO test changes by observing the running simulation** rather than restarting services.

6. **DO commit changes with clear, descriptive messages** explaining what was modified.

---

## Core Game Structure

### Player Roles
- **Crewmates**: Majority of players (6 out of 8 in our simulation)
- **Impostors**: Minority of players (2 out of 8 in our simulation)

### Win Conditions

#### Crewmate Victory
- **Task Completion**: Complete 100% of all assigned tasks
  - Task bar fills incrementally as each subtask completes
  - Dead crewmates can continue completing tasks as ghosts
  - Task win is disabled during active sabotage crises
- **Impostor Elimination**: Vote out all impostors through meetings
  - Requires majority vote (>50% of living players)
  - Tied votes result in no ejection

#### Impostor Victory
- **Numerical Parity**: Living impostors ≥ living crewmates
- **Sabotage Victory**: Crewmates fail to fix critical sabotage in time
  - Reactor meltdown: 30-45 second timer
  - O2 depletion: 30-45 second timer

---

## Movement & Physics System

### Movement Mechanics
- **Base Movement Speed**: 1.0x (adjustable 0.5x-3.0x)
  - Normal walk speed: ~5.5 units/second at 1.0x
  - Diagonal movement: Same speed (normalized vector)
  - No acceleration/deceleration (instant start/stop)
  - Collision box: ~0.8 units diameter circle

### Collision System
- **Wall Clipping Prevention**: Ray-based collision detection
- **Player Stacking**: Up to 10 players can occupy same tile
- **Door Interactions**: Closed doors block all movement
- **Vent Entry**: Requires exact positioning (±0.3 units)
- **Cannot Phase Through**: Players cannot walk through walls or each other
- **Corpses Don't Block**: Dead bodies don't block movement

---

## Vision & Perception System

### Field of View Mathematics
- **Vision Formula**: Visible Distance = Base_Vision × Vision_Multiplier × Environmental_Modifier
- **Light Radius During Sabotage**: Normal_Vision × 0.25
- **Impostor Vision Bonus**: Typically +0.5x to +1.5x during lights out

### Line of Sight Details
- **Raycast System**: 360° ray emission from player center
- **Wall Occlusion**: Complete blockage by walls/doors
- **Player Transparency**: Other players don't block vision
- **Fog of War Gradient**:
  - 100% visibility: 0-70% of vision radius
  - Gradual fade: 70-100% of vision radius
  - Complete darkness: Beyond vision radius

### Vision During Different States
1. **Normal Gameplay**: Full configured vision
2. **Lights Sabotage**: Crewmate vision × 0.25, Impostor unchanged
3. **Communications Sabotage**: No vision impact
4. **In Vents**: Zero external vision, only see vent network
5. **As Ghost**: Unlimited vision, see everything

---

## Task System

### Task Assignment Algorithm
- **Common Tasks**: 0-2 (all players get same ones or none)
- **Long Tasks**: 0-3 per player
- **Short Tasks**: 0-5 per player
- **Visual Tasks**: Maximum 1-2 per player
- **Total Tasks**: Usually 4-8 per crewmate

### Task Types

#### Short Tasks (1-5 seconds)
| Task | Duration | Locations | Mechanics |
|------|----------|-----------|-----------|
| Swipe Card | 2-3s | Admin | Must swipe at correct speed |
| Prime Shields | 3s | Shields | Click hexagons in sequence |
| Empty Garbage | 2s | Cafeteria/O2 | Hold lever down |
| Chart Course | 3s | Navigation | Drag ship through 4 waypoints |
| Stabilize Steering | 2s | Navigation | Click crosshair when centered |
| Unlock Manifolds | 4s | Reactor | Click numbers 1-10 in order |
| Clean O2 Filter | 4s | O2 | Drag leaves away |
| Divert Power (Stage 1) | 2s | Electrical | Slide lever up |
| Accept Power (Stage 2) | 1s | Various | Click fuse |

#### Long Tasks (10-60 seconds)
| Task | Duration | Locations | Mechanics |
|------|----------|-----------|-----------|
| Start Reactor | 10s | Reactor | Simon Says memory game |
| Submit Scan | 10s | MedBay | Stand still (VISUAL) |
| Inspect Sample | 60s | MedBay | Wait, then select anomaly |
| Fuel Engines | 20s total | Storage→Engines | Fill gas can, then deposit (multiple trips) |
| Upload Data | 9s | Admin | Wait for upload bar |
| Download Data | 9s | Various | Wait for download bar |
| Clear Asteroids | 20s | Weapons | Destroy 20 asteroids (VISUAL) |
| Fix Wiring | 3s×3 | Various | Connect matching colored wires (3 panels) |
| Calibrate Distributor | 3s | Electrical | Time 3 rotating nodes |
| Align Engine Output | 3s×2 | Upper/Lower Engine | Align engine thrust |

### Task Validation System
- **Positional Requirement**: Within 1.5 units of task location
- **Facing Direction**: Not required in original game
- **Task Progress Bar**: Updates only when subtask fully completes
- **Multi-Stage Tasks**: Must complete in sequence
- **Task Interruption**: Closing task resets current progress
- **Ghost Tasks**: Count toward victory but no animation

---

## Impostor Abilities

### Kill Mechanics
- **Range**: Short (1.0 units), Medium (1.8 units), Long (2.5 units)
- **Animation Duration**: 0.5 seconds (killer frozen)
- **Cooldown**: 10-60 seconds (typically 25-45s)
- **Kill Button Visibility**: Shows when target in range
- **Multi-Kill Prevention**: Can't kill during kill animation
- **Report Distance**: 2.5 units from body center

### Sabotage System Details

#### Reactor Meltdown
- **Timer**: 30-45 seconds countdown
- **Fix Requirements**: 2 players hold hand scanners simultaneously
- **Location**: Reactor room, opposite sides
- **Audio**: Klaxon alarm, increasing tempo
- **Visual**: Red warning lights flash
- **Strategy**: Forces crewmates to specific location

#### Oxygen Depletion
- **Timer**: 30-45 seconds countdown
- **Fix Requirements**: Enter codes at 2 locations
- **Locations**: O2 and Admin
- **Code**: 5-digit number, same at both terminals
- **Visual**: O2 percentage decreases on displays
- **Strategy**: Splits up crewmates

#### Lights Sabotage
- **Duration**: Until fixed
- **Effect**: Crewmate vision reduced to 0.25x
- **Fix**: Toggle 5 switches to match pattern
- **Location**: Electrical panel
- **Impostor Advantage**: Maintain full vision
- **Strategy**: Create kill opportunities with limited visibility

#### Communications Sabotage
- **Duration**: Until fixed
- **Effects**:
  - Task list hidden
  - Task arrows disabled
  - Admin table disabled
  - Security cameras disabled
- **Fix**: Rotate dial to match frequency
- **Location**: Communications room
- **Strategy**: Disable crewmate information gathering

#### Door Sabotage
- **Duration**: 10 seconds per door
- **Cooldown**: 10-30 seconds ship-wide
- **Simultaneously**: Can close multiple doors at once
- **Opening**: Automatic after timer or crisis fix
- **Strategic Doors**:
  - Cafeteria: 5 doors (maximum isolation)
  - Storage: 2 doors (trap potential)
  - MedBay/Security: 1 door each (isolation rooms)

### Vent Network Mechanics
- **Entry Time**: 0.3 seconds
- **Exit Time**: 0.3 seconds
- **Travel Time**: Instant between connected vents
- **Vision in Vents**: Only see vent UI, no external vision
- **Movement in Vents**: Click arrows or connected vent icons
- **Detection**: Vent animation visible for 0.3s on entry/exit
- **Cooldown**: ~2 seconds between vent uses

#### Vent Networks (4 Separate Systems)
1. **West Network**: Upper Engine ↔ Lower Engine ↔ Reactor
2. **Central Network**: MedBay ↔ Electrical ↔ Security
3. **East Network**: Navigation ↔ Weapons ↔ Shields
4. **Cafeteria Network**: Cafeteria ↔ Admin

---

## Meeting & Voting Mechanics

### Meeting Initiation

#### Emergency Button
- **Location**: Center of Cafeteria table
- **Personal Cooldown**: 15-60s after meeting ends
- **Personal Limit**: 1-9 meetings per player per game
- **Global Cooldown**: First 15-60s of game
- **Animation**: Hand slam animation (0.5s)

#### Body Reporting
- **Detection Range**: 2.5 units
- **Report Priority**: Overrides all other actions
- **Information Provided**: Body location, reporter identity
- **Body State**: Shows kill age via color fade

### Discussion Phase Mechanics
- **Discussion Timer**: 15-120 seconds
- **No Voting Allowed**: Players can only chat
- **Free Text Chat**: Or voice communication
- **Player Icons**: Show alive/dead status
- **Anonymous Voting Preparation**: Players consider their vote

### Voting Phase Mechanics
- **Voting Timer**: 15-300 seconds
- **Each Player**: 1 vote or skip
- **Vote Changing**: Allowed until timer ends
- **Vote Locking**: Final 5 seconds no changes
- **Anonymous Voting**: Optional, hides who voted for whom
- **Vote Reveal**: Shows all votes simultaneously

### Ejection Mechanics
- **Ejection Animation**: 5 seconds
- **Confirm Ejects Setting**: Shows if ejected player was impostor
- **Ejection Text Variables**:
  - "[Name] was An Impostor. X Impostors remain"
  - "[Name] was not An Impostor. X Impostors remain"
- **Tie Resolution**: No ejection on tied votes
- **Skip Majority**: Treated as vote option

---

## Ghost Mechanics

### Ghost Abilities
- **Movement**: Same speed as alive, pass through walls
- **Vision**: Unlimited range, see everything
- **Tasks**: Can complete remaining tasks
- **Sabotage**: Cannot trigger or fix
- **Communication**: Can only chat with other ghosts
- **Visibility**: Partially transparent to other ghosts only

---

## The Skeld Map - Strategic Analysis

### Map Layout & Dimensions
- **Total Size**: Approximately 60×40 units
- **14 Named Rooms** + corridors
- **3 Vertical Levels**: Upper deck, main deck, lower deck

### Room Breakdown

#### Left Wing (West)
1. **Upper Engine**
   - Tasks: Align Engine Output, Accept Diverted Power
   - Vent: Connected to Lower Engine and Reactor
   - Single entrance from corridor
   - **Dead End**: High risk area

2. **Lower Engine**
   - Tasks: Align Engine Output, Accept Diverted Power
   - Vent: Connected to Upper Engine and Reactor
   - Single entrance from corridor
   - **Dead End**: High risk area

3. **Reactor**
   - Tasks: Start Reactor, Unlock Manifolds
   - Sabotage: Reactor Meltdown (critical)
   - Vent: Connected to Upper/Lower Engine
   - Two-hand authentication required for meltdown fix
   - Decontamination corridor to Upper Engine
   - **Dead End**: High risk area

#### Central Section
4. **Security**
   - Tasks: Accept Diverted Power, Fix Wiring
   - Special: Camera monitoring station (4 cameras)
   - Vent: Connected to Electrical and MedBay
   - Single entrance from upper corridor
   - **Dead End**: Medium risk

5. **MedBay**
   - Tasks: Submit Scan (visual), Inspect Sample
   - Vent: Connected to Electrical and Security
   - Single entrance from upper corridor
   - **Dead End**: High risk area

6. **Electrical**
   - Tasks: Fix Wiring, Divert Power, Calibrate Distributor
   - Vent: Connected to MedBay and Security
   - **High-Risk Area**: Single entrance, poor visibility
   - Sabotage: Lights control
   - **Most Dangerous Room**: Dead end with single entrance

7. **Cafeteria**
   - Central hub area
   - Tasks: Fix Wiring, Empty Garbage, Download Data
   - Emergency Button location
   - Vent: Connected to Admin
   - Multiple entrances (5 total)
   - **Safest Area**: High traffic, multiple exits

8. **Storage**
   - Tasks: Fix Wiring, Fuel Engines (fuel pickup)
   - No vents
   - Large open area
   - Two entrances
   - **Moderately Safe**: Multiple exits

9. **Admin**
   - Tasks: Swipe Card, Fix Wiring, Upload Data
   - Vent: Connected to Cafeteria
   - Special: Admin Table (shows player locations)
   - Two entrances
   - **Strategic Location**: Crossroads

#### Right Wing (East)
10. **Communications**
    - Tasks: Download Data, Accept Diverted Power
    - Sabotage: Communications (hides tasks)
    - No vents
    - Single entrance
    - **Dead End**: High risk area

11. **O2 (Life Support)**
    - Tasks: Clean O2 Filter, Empty Garbage
    - Sabotage: Oxygen Depletion
    - No vents
    - Narrow entrance from Navigation
    - **Dead End**: High risk area

12. **Navigation**
    - Tasks: Chart Course, Stabilize Steering, Download Data
    - Vent: Connected to Weapons and Shields
    - Two entrances (O2 and corridor)
    - **Medium Risk**: Corner location

13. **Weapons**
    - Tasks: Clear Asteroids (visual), Download Data
    - Vent: Connected to Navigation and Shields
    - Single entrance from corridor
    - **Dead End**: High risk area

14. **Shields**
    - Tasks: Prime Shields (visual), Accept Diverted Power
    - Vent: Connected to Navigation and Weapons
    - Single entrance from corridor
    - **Dead End**: High risk area

### Critical Map Features

#### Camera Locations
1. **Navigation corridor** - Monitors Nav/Shields area
2. **Admin corridor** - Monitors Admin/Cafeteria area
3. **Security entrance** - Monitors Security hallway
4. **MedBay entrance** - Monitors MedBay hallway

#### Choke Points
- **Electrical**: Dead end, single entrance (MOST DANGEROUS)
- **Storage-to-Electrical corridor**: Narrow passage
- **O2-to-Navigation passage**: Isolated connection
- **Decontamination areas**: 3-second forced walk zones

#### High-Risk Areas (Dead Ends)
1. Electrical (highest risk - single entrance)
2. Upper Engine
3. Lower Engine
4. Reactor
5. MedBay
6. Security
7. Weapons
8. Shields
9. Communications
10. O2

#### High-Traffic Areas (Safer)
1. Cafeteria (central hub, 5 entrances)
2. Storage (connection between sections)
3. Admin (crossroads location)
4. Upper Corridor (main east-west route)

#### Decontamination Zones
- **Upper Engine ↔ Reactor**: 3 second forced walk
- **Laboratory ↔ Reactor** (MedBay side): 3 second forced walk
- **Door Lock Override**: Cannot close during decontamination

---

## Audio & Visual Cues

### Sound Effects
- **Kill Sound**: Sharp stab/slash
- **Vent Sound**: Metallic clang (proximity-based) - Implemented - vent-in and vent-out sounds
- **Task Completion**: Soft chime
- **Sabotage Alarm**: Different for each type
- **Meeting Horn**: Loud emergency sound
- **Footsteps**: Subtle, only when moving

### Visual Indicators
- **Task Animations**: Scanner green light, weapons firing, shields activating
- **Kill Animation**: Brief struggle, body drops
- **Vent Animation**: Grid opens/closes
- **Sabotage Indicators**: Red flashing lights, warning symbols
- **Report Button**: Megaphone icon appears
- **Kill Button**: Red with knife icon

---

## Game Settings Reference

### Host Configuration Options
```
Map Settings:
- Player Speed: 0.5x - 3.0x
- Crewmate Vision: 0.25x - 5.0x
- Impostor Vision: 0.25x - 5.0x
- Kill Cooldown: 10s - 60s
- Kill Distance: Short/Medium/Long
- Visual Tasks: On/Off
- Common Tasks: 0-2
- Long Tasks: 0-3
- Short Tasks: 0-5
- Emergency Meetings: 1-9 per player
- Emergency Cooldown: 0-60s
- Discussion Time: 0-120s
- Voting Time: 0-300s
- Anonymous Votes: On/Off
- Confirm Ejects: On/Off
- Task Bar Updates: Always/Meetings/Never
```

---

## AI Agent Strategy Considerations

### Crewmate Strategy
1. **Task Efficiency**: Prioritize nearby tasks, avoid backtracking
2. **Safety Assessment**: Avoid dead ends when alone
3. **Buddy System**: Stay near trusted players
4. **Visual Task Verification**: Watch others do visual tasks
5. **Meeting Reasoning**: Share observations, build trust network
6. **Alibi Tracking**: Remember where players were seen
7. **Suspicion Management**: Track suspicious behaviors
8. **Emergency Usage**: Call meetings when evidence is strong

### Impostor Strategy
1. **Kill Opportunity Assessment**: Isolated targets, no witnesses
2. **Target Selection**: Prioritize threats (good players, visual task holders)
3. **Alibi Creation**: Fake tasks convincingly
4. **Sabotage Timing**: Create chaos before kills
5. **Venting Tactics**: Use for escape routes, not travel
6. **Blame Deflection**: Redirect suspicion to others
7. **Meeting Deception**: Create plausible stories
8. **Vote Manipulation**: Lead votes against innocents
9. **Double Kill Coordination**: When two impostors work together
10. **Self-Report Strategy**: Report own kills to appear innocent

### Danger Assessment Factors
1. **Room Type**: Dead end vs multiple exits
2. **Player Count**: Alone vs with others
3. **Visibility**: Lights on vs sabotaged
4. **Camera Coverage**: In view of cameras or not
5. **Recent Kills**: Bodies found nearby
6. **Impostor Cooldown**: Time since last kill
7. **Trust Level**: With trusted vs suspicious players

### Suspicion Indicators
1. **Fake Tasking**: Standing near task without doing it
2. **Following Behavior**: Trailing other players
3. **Vent Sighting**: Saw player enter/exit vent
4. **Contradictory Statements**: Lies about location/alibi
5. **Avoiding Cameras**: Deliberately avoiding monitored areas
6. **Kill Zone Presence**: Near body discovery location
7. **Sabotage Timing**: Benefits from sabotage timing
8. **Vote Patterns**: Consistently voting with impostors

---

## Logging System

The simulation uses a comprehensive, universal logging system that provides structured JSON output with color-coded console display.

### Log Levels

| Level | Value | Usage |
|-------|-------|-------|
| TRACE | 0 | Very detailed debugging, high-frequency events |
| DEBUG | 1 | General debugging information |
| INFO | 2 | Significant events (default level) |
| WARN | 3 | Potential issues, recoverable errors |
| ERROR | 4 | Errors that affect functionality |
| FATAL | 5 | Critical failures |
| SILENT | 6 | Disable all logging |

### Log Categories

```
AI          - AI decision making and LLM interactions
SIMULATION  - Game simulation loop and state
WEBSOCKET   - WebSocket connections and messages
RENDER      - Client-side rendering
AUDIO       - Sound effects and audio playback
MOVEMENT    - Agent pathfinding and navigation
TASK        - Task assignment and completion
KILL        - Kill attempts and deaths
VENT        - Vent entry/exit/travel
MEETING     - Emergency meetings and voting
SABOTAGE    - Sabotage events
MEMORY      - Agent memory and observations
VISION      - Line-of-sight and visibility
ZONE        - Room/area detection
HTTP        - HTTP requests (server)
SYSTEM      - System initialization and shutdown
PERF        - Performance metrics
GOD         - God mode commands and whispers
SPEECH      - Agent speech and hearing
THOUGHT     - Agent internal thoughts
ERROR       - Error category for error handlers
GENERAL     - Uncategorized logs
```

### Usage

**Server-side (server/src/logging/index.ts):**
```typescript
import { aiLogger, simulationLogger, websocketLogger } from '../logging/index.ts';

aiLogger.info('Decision made', { agentId, goalType });
simulationLogger.debug('Tick processed', { tick, deltaTime });
```

**Client-side (src/logging/index.ts):**
```typescript
import { renderLogger, audioLogger, systemLogger } from '../logging/index.ts';

audioLogger.info('Sound loaded', { soundName });
renderLogger.debug('Frame rendered', { fps });
```

**Shared code (shared/logging/sharedLogger.ts):**
```typescript
import { aiLog, moveLog, killLog } from '../logging/index.ts';

// Use .get() to lazily initialize
aiLog.get().info('Agent action', { agentId, action });
moveLog.get().debug('Path found', { waypoints: path.length });
```

### Console Output

Logs display with:
- **Text prefixes** per level ([TRC], [DBG], [INF], [WRN], [ERR], [FTL])
- **Category labels** (AI, SIM, WS, RND, AUD, MOV, etc.)
- **Color coding** by log level (cyan=DEBUG, green=INFO, yellow=WARN, red=ERROR)
- **Timestamp** in HH:mm:ss.SSS format
- **Structured context** pretty-printed below the message

### File Logging (Server Only)

Single JSON log file stored in `logs/`:
- Max 1 file (no rotation)
- Max 1GB file size
- Buffered writes for performance
- Named as `simulation.log`

### Browser Console

Set log level at runtime:
```javascript
window.setLogLevel('DEBUG');  // Show debug and above
window.setLogLevel('WARN');   // Only warnings and errors
```

---

## Implementation Status

> This section documents what is **currently implemented** in the Agentic Among Us simulation versus what is documented above but not yet active.

### Fully Implemented

| System | Details |
|--------|---------|
| **Universal Logging System** | Structured JSON logging with color-coded console output, single 1GB log file, log levels (TRACE-FATAL), 22 categories (AI, SIMULATION, WEBSOCKET, RENDER, AUDIO, MOVEMENT, TASK, KILL, VENT, MEETING, SABOTAGE, MEMORY, VISION, ZONE, HTTP, SYSTEM, PERF, GOD, SPEECH, THOUGHT, ERROR, GENERAL), lazy-loaded shared loggers, separate client/server transports, text prefixes instead of emojis |
| **Movement & Physics** | A* pathfinding, steering behaviors, collision avoidance, wall-whisker detection |
| **Navigation Mesh** | Full Skeld map with walkable zones, room labels, hallways |
| **Vision System** | Configurable vision radius, line-of-sight calculations |
| **Task System** | Task assignment (5 per agent), navigation to tasks, execution with durations |
| **Task Progress Bar** | Smooth animated progress bar (0-100%) while player performs task, with checkmark completion animation. Uses client-side time calculation from task `startedAt` timestamp for smooth rendering |
| **Impostor Task Faking** | Wait at task location for appropriate duration without progress |
| **Zone Detection** | Agents know their current room/hallway location |
| **Agent Memory** | Observations, suspicion levels, conversation history, alibi tracking. **Timestamped history** with relative time formatting (e.g., "30s ago", "2m ago") included in LLM prompts. Memory context shows: recent timeline (last 15 events merged chronologically), last known player locations, suspicion levels with reasons, and alibis claimed. |
| **Thought System** | Internal reasoning triggered by events (room entry, spotting agents, etc.). Thoughts shown as cloud-shaped bubble with trailing circles above player. Toggleable via THT button. |
| **Thinking Indicator** | Animated "..." dots shown when agent is waiting for LLM response. Toggleable via ... button. |
| **Speech System** | Agents speak to nearby players, vision-based hearing (same radius and line-of-sight as vision - can't hear through walls). Speech shown as rectangular bubble with tail pointer above player. Toggleable via SPK button. |
| **Conversation Threading** | Conversations tracked with unique IDs (conversationId), turn numbers, and participant names. LLM timeline panel shows conversation info ([T1], [T2], etc.) and allows drilling into full conversation threads via 🔗 button. |
| **Social Actions** | Buddy up, follow, avoid, confront, spread rumors, defend self |
| **AI Decision Making** | LLM-powered with 10 goal types (see below) |
| **Kill Sound Effects** | Audio plays on new body detection with browser autoplay unlock |
| **Vent Sound Effects** | Audio plays on vent enter/exit events (vent-in and vent-out sounds) |
| **Hearing System** | Visual ear icon with directional sound waves when agents hear speech. HeardSpeechEvent emitted for each listener. "Recently Heard" section in agent info panel shows what agent heard with direct-address highlighting. |
| **God Mode** | Divine control system allowing observers to override agent behavior (see below) |
| **Game Phase System** | WORKING → ALERT phase transition triggered by first body discovery. Crewmates behave differently based on phase (friendly workers vs suspicious investigators). Impostors adapt blending behavior per phase. |
| **Body Discovery System** | Agents can witness dead bodies (witnessed_body trigger), triggers **LLM decision** (agent chooses to REPORT_BODY, FLEE_BODY, SELF_REPORT, etc.). REPORT_BODY is now prominently emphasized in the prompt with the body info and limited goal options. Broadcast report to all agents. Phase transitions WORKING→ALERT on first discovery. All bodies cleared on report. |
| **Witness Kill System** | Agents who see a kill get witnessMemory populated with killer color and confidence. This is now prominently displayed in decision prompts with "YOU WITNESSED A MURDER!" alert. Killer's name shown if identified. |
| **Body Report UI** | Red flash overlay with victim names, reporter info, auto-dismiss after 3s. Audio plays body-report.mp3 sound effect. |
| **Phase-Aware AI Prompts** | Crewmate prompts: WORKING phase = friendly workers, no danger awareness; ALERT phase = suspicious investigators with alibis. Impostor prompts: blend in more during WORKING, strategic killing/deception during ALERT. |
| **Full Memory Display** | Memory tab in agent profile shows complete dump: All Observations (color-coded by type), All Conversations, Accusations, Alibis, and Recently Heard. Scrollable lists with timestamps and zones. |
| **LLM Timeline Filters** | Filter panel with: (1) Agent color circles - click to filter by specific agents, (2) Goal type buttons - filter by decision types like GO_TO_TASK, WANDER, HUNT, KILL, REPORT_BODY. Filters combinable with clear buttons. |
| **Vent System AI Integration** | Full vent mechanics: entry/exit animations, vent-to-vent travel, cooldowns, witness detection. AI agents can ENTER_VENT, EXIT_VENT, VENT_TRAVEL as goal types. Vent context provided to LLM with current state, connected vents, and nearby witnesses. Sound effects on vent use. |
| **Sabotage System** | Full sabotage mechanics via SabotageSystem.ts: LIGHTS, REACTOR, O2, COMMS sabotage types. Impostor AI can trigger sabotages via SABOTAGE goal type. Crewmate AI can FIX_SABOTAGE. Cooldowns between sabotages. State broadcast to clients via WorldSnapshot/WorldDelta. Lights affect vision (crewmate vision reduced to 0.25x). |
| **Ghost Mode** | GhostSystem.ts manages ghost transitions. Dead players (DEAD state) transition to GHOST state when body is reported or after 30s timeout. Ghosts: (1) Can pass through walls (collision disabled), (2) Get unlimited vision (10x multiplier), (3) Can continue completing tasks, (4) Can only communicate with other ghosts. Ghosts rendered as semi-transparent floating sprites. |

### God Mode System (Active)

God Mode allows observers to take divine control of AI agents through three mechanisms:

#### Direct Commands
Bypass the LLM entirely and force an agent to perform a specific action:
- Agent's AI decision-making is suspended during command execution
- Visual indicator shows agent is under divine control (pulsing golden glow)
- Once command completes, agent returns to normal AI behavior

**Available Commands:**
| Command | All Agents | Impostor Only | Description |
|---------|------------|---------------|-------------|
| `wander` | Yes | | Random exploration |
| `idle` | Yes | | Stop and wait |
| `go_to_task` | Yes | | Navigate to selected task |
| `speak` | Yes | | Say something to nearby agents |
| `follow` | Yes | | Follow a target agent |
| `avoid` | Yes | | Stay away from target agent |
| `vent` | | Yes | Enter nearest vent |
| `kill` | | Yes | Kill nearest crewmate in range |
| `hunt` | | Yes | Seek isolated targets |
| `flee` | | Yes | Run from current location |
| `alibi` | | Yes | Create an alibi by faking task |
| `self_report` | | Yes | Report own kill |

#### Whispers (Prompt Injection)
Inject a divine whisper into the agent's next LLM prompt:
- Appears as "A voice whispers in your head: [message]"
- Agent's LLM considers the whisper alongside normal observations
- Single-use: clears after the next decision
- Useful for subtle influence without direct control

#### Guiding Principles (Persistent)
Add persistent behavioral modifications:
- Injected into every LLM prompt until removed
- Multiple principles can be active simultaneously
- Examples: "You vent frequently", "You trust no one", "You are paranoid"
- Can be added/removed individually

#### UI Access
- Click on any agent to open their info panel
- Select the "Control" tab (shows * when god mode is active)
- Quick command buttons for common actions
- Task dropdown for GO_TO_TASK commands
- Custom message input for SPEAK commands
- Whisper input with "Send Whisper" button
- Principles list with add/remove functionality
- "Clear All God Mode" button to reset

### AI Decision Types (Active)

**Crewmate & Impostor Goals:**
```
GO_TO_TASK     - Navigate to assigned task location
WANDER         - Random exploration of the map
FOLLOW_AGENT   - Tail another agent for safety or suspicion
AVOID_AGENT    - Stay away from suspicious players
BUDDY_UP       - Team up with trusted players
CONFRONT       - Question suspicious behavior face-to-face
SPREAD_RUMOR   - Share suspicions with other agents
DEFEND_SELF    - Provide alibis when accused
SPEAK          - General conversation
IDLE           - Wait and observe surroundings
REPORT_BODY    - Report a dead body (triggers meeting in full game)
```

**Impostor-Only Goals:**
```
KILL           - Eliminate a crewmate (requires target in range, cooldown ready)
HUNT           - Actively seek isolated targets for kills
SELF_REPORT    - Report own kill to appear innocent
FLEE_BODY      - Get away from body after a kill
CREATE_ALIBI   - Position near witnesses/tasks after kill for cover
```

### Thought Triggers (Active)

```
arrived_at_destination  - Reached navigation target
task_completed          - Finished a task
task_started            - Began working on a task
agent_spotted           - Another agent entered vision
agent_lost_sight        - Agent left vision range
entered_room            - Moved into a new room
idle_random             - Periodic thoughts while idle
heard_speech            - Heard another agent speak
passed_agent_closely    - Brief proximity encounter
task_in_action_radius   - Task location nearby
witnessed_suspicious_behavior - Saw suspicious activity (venting, near body, etc.)
witnessed_body          - Saw a dead body, triggers REPORT_BODY decision
target_entered_kill_range - IMPOSTOR ONLY: Crewmate entered kill range, forces immediate decision
near_vent              - IMPOSTOR ONLY: Near a vent, might consider using it
entered_vent           - IMPOSTOR ONLY: Just entered a vent
exited_vent            - IMPOSTOR ONLY: Just exited a vent
witnessed_vent_activity - Crewmate/Impostor: Saw someone enter/exit a vent
alone_with_vent        - IMPOSTOR ONLY: Alone in a room with a vent
```

### Not Yet Implemented

| System | Status | Notes |
|--------|--------|-------|
| **Kill Mechanics** | Partial | KillSystem class exists with cooldowns, range checks, witnesses; kills can be attempted but game state doesn't update victims to DEAD |
| **Body Discovery** | Implemented | witnessed_body trigger, REPORT_BODY goal, body report callback chain, phase transition, memory broadcast, UI overlay with audio |
| **Emergency Meetings** | No | Button location exists but non-functional |
| **Discussion Phase** | No | No meeting chat or accusations |
| **Voting System** | No | No vote casting or counting |
| **Ejection** | No | No player removal |
| **Sabotage (Reactor)** | Partial | SabotageSystem supports REACTOR type with timers, but requires 2-player fix coordination (not fully tested) |
| **Sabotage (O2)** | Partial | SabotageSystem supports O2 type with timers, but requires 2-location code entry (not fully tested) |
| **Sabotage (Lights)** | ✅ Implemented | Vision reduction active (crewmate vision × 0.25), fix mechanics in Electrical |
| **Sabotage (Comms)** | Partial | SabotageSystem supports COMMS type, task hiding not yet implemented |
| **Door System** | No | Doors don't close or block movement |
| **Vent System** | ✅ Implemented | Full AI integration: ENTER_VENT, EXIT_VENT, VENT_TRAVEL goals, cooldowns, witness detection, vent context in prompts |
| **Win Conditions** | No | Game runs indefinitely |
| **Ghost Mode** | ✅ Implemented | GhostSystem manages DEAD→GHOST transitions, wall-passing, unlimited vision, ghost-only communication |
| **Security Cameras** | No | No camera monitoring |
| **Admin Table** | No | No player location display |

### Current Simulation Configuration

```
Players:           8 (6 Crewmates, 2 Impostors)
Tasks per Agent:   5
Map:               The Skeld
Tick Rate:         60 Hz
Vision System:     Radius-based with obstruction
AI Backend:        Llama-3.2-1B-Instruct (Q5_K_M) via llama.cpp Docker
LLM Performance:   ~60-150 tokens/sec, ~300-500ms per decision
```

### Map Data Available

The simulation has full Skeld map data including:
- All walkable zone polygons with obstacle holes
- Room and hallway labels (14 named areas)
- 30+ task locations with types and durations
- Vent positions and connections (defined but not usable)
- Door positions (defined but non-functional)
- Camera locations (defined but not active)

### Agent Capabilities Summary

**Crewmates can:**
- Navigate the full Skeld map using pathfinding
- Complete assigned tasks with realistic durations
- See other agents within vision radius
- Remember observations and track suspicion
- Speak to nearby agents
- Form alliances (buddy system)
- Report suspicious behavior via rumors

**Impostors can:**
- Navigate identically to crewmates
- Fake tasks (stand at location without progress)
- Track and follow potential victims
- Spread false information
- Manipulate suspicion through social actions

**Impostors cannot (yet):**
- Kill crewmates
- Use vents for travel
- Trigger sabotages
- Close doors

### Agent Personality System (NEW)

Each agent is assigned a unique personality at game start that affects their behavior, speech patterns, and decision-making.

#### Personality Traits
Each personality has the following configurable traits (0-100 scale):
- **trustLevel**: How likely to trust others (0=paranoid, 100=naive)
- **aggressionLevel**: How aggressive in accusations (0=passive, 100=accusatory)
- **socialLevel**: How social/talkative (0=loner, 100=social butterfly)
- **composure**: How calm under pressure (0=panicky, 100=ice cold)
- **observation**: How observant of details (0=oblivious, 100=eagle eye)
- **leadership**: How likely to lead or follow (0=follower, 100=leader)

#### Speech Characteristics
Each personality includes:
- **catchPhrases**: Common phrases the personality uses
- **greetingStyle**: How they greet others
- **suspicionStyle**: How they express suspicion
- **defenseStyle**: How they defend themselves
- **speechQuirks**: General speech patterns (informal, formal, brief, etc.)

#### Impostor-Specific Traits
Impostor-capable personalities also have:
- **deceptionStyle**: How they deceive others
- **deflectionStyle**: How they deflect blame
- **killAggression**: How aggressive with kills (0-100)

#### Available Personalities (12 total)

**Impostor-Capable (7):**
| ID | Name | Key Traits |
|----|------|------------|
| detective | The Detective | Analytical, asks questions, builds logical cases |
| charmer | The Charmer | Friendly, uses nicknames, builds trust |
| hothead | The Hothead | Quick to anger, loud accusations |
| quiet_one | The Quiet One | Speaks rarely, impactful statements |
| strategist | The Strategist | Plans, coordinates, thinks ahead |
| gossip | The Gossip | Loves drama, spreads info |
| joker | The Joker | Sarcastic, uses humor, never serious |

**Crewmate-Only (5):**
| ID | Name | Key Traits |
|----|------|------------|
| newbie | The Newbie | New to game, trusts easily, asks questions |
| veteran | The Veteran | Experienced, calm, spots patterns |
| paranoid | The Paranoid | Trusts no one, suspects everyone |
| peacemaker | The Peacemaker | Mediates, seeks consensus |
| taskmaster | The Taskmaster | Task-focused, efficient, impatient |

#### How Personalities Are Assigned
1. At game start, `selectPersonalitiesForGame()` picks 8 personalities
2. 2 impostor-capable personalities are assigned to impostors
3. 6 personalities (mix of impostor-capable and crewmate-only) go to crewmates
4. Each agent's `personalityId` is stored in their state
5. LLM prompts include personality-specific instructions
