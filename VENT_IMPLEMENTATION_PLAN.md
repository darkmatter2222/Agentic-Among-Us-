# Vent System Implementation Plan - 20 Point Roadmap

## Overview

This document outlines a comprehensive plan for implementing the vent system in the Agentic Among Us simulation. Venting is a critical impostor-only mechanic that allows:
- Quick traversal across the map through connected vent networks
- Escape routes after kills
- Stealth positioning for ambushes

**Critical Social Dynamic**: Anyone who sees a player enter or exit a vent **immediately** knows they are an impostor. This creates:
- High-risk/high-reward gameplay
- Potential for false accusations ("I saw X vent!")
- Lying opportunities for manipulative agents

---

## Reference: Game Mechanics from `agents.md`

### Vent Network Mechanics (from original Among Us)
- **Entry Time**: 0.3 seconds
- **Exit Time**: 0.3 seconds
- **Travel Time**: Instant between connected vents
- **Vision in Vents**: Only see vent UI, no external vision
- **Movement in Vents**: Click arrows or connected vent icons
- **Detection**: Vent animation visible for 0.3s on entry/exit
- **Cooldown**: ~2 seconds between vent uses

### Vent Networks (4 Separate Systems on The Skeld)
1. **West Network**: Upper Engine ↔ Lower Engine ↔ Reactor
2. **Central Network**: MedBay ↔ Electrical ↔ Security
3. **East Network**: Navigation ↔ Weapons ↔ Shields
4. **Cafeteria Network**: Cafeteria ↔ Admin

### Entry Requirements
- Must be an Impostor
- Must be within vent interaction range (±0.3 units in original, ~10px in our scale)
- Must not be currently in a task or kill animation

---

## 20-Point Implementation Plan

### Phase 1: Core Data & Types (Points 1-4)

#### 1. ✅ Add Vent-Related Types to `game.types.ts`
**Status**: Partially exists (Vent interface exists, Player has `isInVent` and `currentVent`)

**Need to add**:
```typescript
// Vent state tracking
export interface VentState {
  ventId: string;
  occupantId: string | null;
  isAnimating: boolean;
  animationType: 'entry' | 'exit' | null;
  animationStartTime: number | null;
}

// Vent event for tracking observations
export interface VentEvent {
  id: string;
  timestamp: number;
  playerId: string;
  playerName: string;
  ventId: string;
  ventRoom: string;
  eventType: 'ENTER' | 'EXIT' | 'TRAVEL';
  destinationVentId?: string; // For TRAVEL events
  witnesses: Array<{
    id: string;
    name: string;
    distance: number;
  }>;
}
```

**Files**: `shared/types/game.types.ts`

---

#### 2. ✅ Add AI Goal Types for Venting
**Add to `simulation.types.ts`**:
```typescript
export type AIGoalType = 
  // ... existing types ...
  | 'ENTER_VENT'      // Go to nearest accessible vent and enter
  | 'EXIT_VENT'       // Exit current vent at chosen destination
  | 'VENT_TO'         // Enter vent and travel to specific destination
```

**Files**: `shared/types/simulation.types.ts`, `server/src/ai/prompts/AgentPrompts.ts`

---

#### 3. ✅ Create VentSystem Class (Similar to KillSystem)
**New file**: `shared/engine/VentSystem.ts`

```typescript
export interface VentSystemConfig {
  entryTime: number;           // 0.3 seconds
  exitTime: number;            // 0.3 seconds
  cooldownTime: number;        // 2.0 seconds
  interactionRange: number;    // 0.5 units
  visibilityDetectionRange: number; // How far witnesses can see vent usage
}

export class VentSystem {
  private ventStates: Map<string, VentState>;
  private ventEvents: VentEvent[];
  private playerCooldowns: Map<string, number>;
  
  // Core methods
  canEnterVent(playerId: string, ventId: string): VentValidation;
  canExitVent(playerId: string, destinationVentId: string): VentValidation;
  enterVent(playerId: string, ventId: string): VentEvent | null;
  exitVent(playerId: string, destinationVentId: string): VentEvent | null;
  travelInVent(playerId: string, fromVentId: string, toVentId: string): boolean;
  
  // Query methods
  getConnectedVents(ventId: string): Vent[];
  getNearbyVents(position: Point, range: number): Vent[];
  getPlayersInVents(): Map<string, string>; // playerId -> ventId
  
  // Witness detection
  getWitnessesForVentEvent(ventPosition: Point, excludePlayerId: string): Witness[];
}
```

---

#### 4. ✅ Add Vent Data Helper Functions
**Enhance** `shared/data/skeld-map-accurate.ts`:

```typescript
// Already exists: getAllVentsAccurate(), getVentById()
// Need to add:
export function getVentNetwork(ventId: string): Vent[];
export function getVentsByRoom(roomId: string): Vent[];
export function getNearestVent(position: Point): Vent | null;
export function canTravelBetween(fromVentId: string, toVentId: string): boolean;
```

---

### Phase 2: Server-Side Logic (Points 5-9)

#### 5. ✅ Integrate VentSystem into SimulationManager
**Files**: `server/src/simulation/SimulationManager.ts`

- Initialize VentSystem with map data
- Add vent request callback to AIAgent (similar to kill callback)
- Process vent events each tick
- Broadcast vent events to clients

```typescript
// In SimulationManager
private ventSystem: VentSystem;

private handleVentRequest(playerId: string, action: 'enter' | 'exit', ventId: string): boolean {
  // Validate and execute vent action
  // Return success/failure
}
```

---

#### 6. ✅ Add Vent Context to AIContext
**Files**: `shared/types/simulation.types.ts`

```typescript
export interface AIContext {
  // ... existing fields ...
  
  // Vent context (impostor only)
  ventContext?: {
    isInVent: boolean;
    currentVentId: string | null;
    connectedVents: Array<{
      id: string;
      room: string;
      distance: number;        // Travel distance if exiting there
      witnessRisk: number;     // 0-100, based on nearby players
    }>;
    nearbyVents: Array<{
      id: string;
      room: string;
      distance: number;
      canEnter: boolean;       // Within range
      witnessRisk: number;
    }>;
    ventCooldownRemaining: number;
  };
}
```

---

#### 7. ✅ Add Vent Decision Prompts for AI
**Files**: `server/src/ai/prompts/AgentPrompts.ts`, `server/src/ai/AIDecisionService.ts`

Add impostor-specific prompts for vent usage:

```typescript
// In buildSystemPrompt for impostors:
VENT MECHANICS (Impostor Only):
- You can use vents to travel quickly between connected locations
- WARNING: Anyone who sees you enter/exit a vent KNOWS you're the impostor!
- Current vent network connections: [show connected vents]
- Use vents strategically for:
  - Escaping after kills
  - Quick positioning
  - Ambush setups
- Available vent actions: ENTER_VENT, EXIT_VENT, VENT_TO
```

---

#### 8. ✅ Implement Witness Detection for Vent Events
**In VentSystem**:

```typescript
getWitnessesForVentEvent(
  ventPosition: Point,
  excludePlayerId: string,
  allPlayers: Map<string, AIAgent>
): Witness[] {
  const witnesses: Witness[] = [];
  
  allPlayers.forEach((agent, playerId) => {
    if (playerId === excludePlayerId) return;
    if (agent.getPlayerState() !== 'ALIVE') return;
    
    const distance = calculateDistance(agent.getPosition(), ventPosition);
    if (distance <= agent.getVisionRadius()) {
      // Check line of sight
      if (hasLineOfSight(agent.getPosition(), ventPosition)) {
        witnesses.push({
          id: playerId,
          name: agent.getName(),
          distance
        });
      }
    }
  });
  
  return witnesses;
}
```

---

#### 9. ✅ Add Memory Events for Vent Sightings
**Files**: `shared/engine/AgentMemory.ts`

```typescript
// Add new KnownInfoType
VENT_SEEN: 'VENT_SEEN'  // Already exists in game.types.ts!

// In AgentMemory, add method:
recordVentSighting(
  suspectId: string,
  suspectName: string,
  ventId: string,
  ventRoom: string,
  eventType: 'ENTER' | 'EXIT',
  timestamp: number
): void {
  // This is CONCLUSIVE evidence of impostor!
  // Set suspicion to 100% immediately
  this.setSuspicionLevel(suspectId, 100);
  
  // Record the observation
  this.observations.push({
    type: 'VENT_SEEN',
    subjectId: suspectId,
    location: ventRoom,
    timestamp,
    details: `Saw ${suspectName} ${eventType.toLowerCase()} vent in ${ventRoom}`
  });
}
```

---

### Phase 3: AI Decision Making (Points 10-13)

#### 10. ✅ Add Vent Actions to AIAgent
**Files**: `shared/engine/AIAgent.ts`

```typescript
// Add vent request callback type
export type VentRequestCallback = (
  playerId: string,
  action: 'enter' | 'exit',
  ventId: string
) => boolean;

// In AIAgent class:
private ventRequestCallback?: VentRequestCallback;

setVentRequestCallback(callback: VentRequestCallback): void {
  this.ventRequestCallback = callback;
}

// Add vent action methods:
private async enterVent(ventId: string): Promise<boolean>;
private async exitVent(destinationVentId: string): Promise<boolean>;
private async ventTo(destinationVentId: string): Promise<boolean>;

// In executeDecision():
case 'ENTER_VENT':
  await this.enterVent(decision.targetVentId);
  break;
case 'EXIT_VENT':
  await this.exitVent(decision.targetVentId);
  break;
case 'VENT_TO':
  await this.ventTo(decision.targetVentId);
  break;
```

---

#### 11. ✅ Add Vent Thought Triggers
**Files**: `shared/engine/AIAgent.ts`

```typescript
// New thought triggers
export type ThoughtTrigger = 
  // ... existing ...
  | 'near_vent'              // Impostor near accessible vent
  | 'saw_vent_event'         // Witnessed someone use a vent
  | 'entered_vent'           // Just entered a vent
  | 'in_vent_deciding'       // In vent, deciding where to exit
  | 'exited_vent'            // Just exited a vent

// Trigger when impostor approaches vent
private checkVentProximityTrigger(): ThoughtTrigger | null {
  if (this.aiState.role !== 'IMPOSTOR') return null;
  if (this.aiState.isInVent) return null;
  
  const nearbyVent = this.getNearestVent();
  if (nearbyVent && nearbyVent.distance < 2.0) {
    return 'near_vent';
  }
  return null;
}
```

---

#### 12. ✅ Update AI Prompts to Include Vent Strategy
**Files**: `server/src/ai/AIDecisionService.ts`

When building prompts for impostors:

```typescript
// Include vent information in context
if (context.role === 'IMPOSTOR') {
  const ventInfo = this.buildVentContextInfo(context);
  userPrompt += `\n\nVENT OPTIONS:\n${ventInfo}`;
}

private buildVentContextInfo(context: AIContext): string {
  if (context.ventContext?.isInVent) {
    return `You are INSIDE a vent at ${context.ventContext.currentVentId}.
Connected vents you can exit to:
${context.ventContext.connectedVents.map(v => 
  `- ${v.room}: Witness risk ${v.witnessRisk}%`
).join('\n')}

Choose wisely - exiting near witnesses will expose you!`;
  } else {
    return `Nearby vents:
${context.ventContext?.nearbyVents.map(v =>
  `- ${v.room} (${v.distance.toFixed(1)} units away): ${v.canEnter ? 'Accessible' : 'Too far'}, Witness risk: ${v.witnessRisk}%`
).join('\n')}`;
  }
}
```

---

#### 13. ✅ Parse Vent Actions from AI Response
**Files**: `server/src/ai/prompts/AgentPrompts.ts`

```typescript
// Update regex to include vent actions
const goalMatch = response.match(
  /GOAL:\s*(GO_TO_TASK|WANDER|...|ENTER_VENT|EXIT_VENT|VENT_TO)/i
);

// Parse vent target
const ventTargetMatch = response.match(/VENT_TARGET:\s*(\w+)/i);

if (goalType === 'ENTER_VENT' || goalType === 'EXIT_VENT' || goalType === 'VENT_TO') {
  decision.targetVentId = ventTargetMatch?.[1];
}
```

---

### Phase 4: Client-Side Rendering (Points 14-17)

#### 14. ✅ Enhance VentSprite with Animation States
**Files**: `src/rendering/ObjectRenderer.ts`

```typescript
class VentSprite {
  // Add animation state
  private state: 'closed' | 'opening' | 'open' | 'closing' = 'closed';
  private animationProgress: number = 0;
  private occupantId: string | null = null;
  
  // Animate vent grate opening/closing
  setAnimationState(state: 'opening' | 'closing', occupantId?: string): void;
  
  // Draw method updates:
  private draw(): void {
    // Draw grate based on animation progress
    // 0 = closed (grate visible)
    // 1 = open (grate slid aside)
    
    if (this.animationProgress > 0) {
      // Draw open vent (dark hole)
      this.drawOpenVent();
    }
    this.drawGrate(1 - this.animationProgress); // Slide grate
    
    // Highlight if impostor nearby (for debug/spectator view)
    if (this.showHighlight) {
      this.drawHighlight();
    }
  }
}
```

---

#### 15. ✅ Add Player Vent Entry/Exit Animations
**Files**: `src/rendering/PlayerRenderer.ts`

```typescript
class PlayerSprite {
  // Add vent animation state
  private ventAnimationType: 'entering' | 'exiting' | null = null;
  private ventAnimationProgress: number = 0;
  private ventPosition: Point | null = null;
  
  // Start vent animation
  startVentAnimation(type: 'entering' | 'exiting', ventPosition: Point): void {
    this.ventAnimationType = type;
    this.ventAnimationProgress = 0;
    this.ventPosition = ventPosition;
  }
  
  // In animate():
  if (this.ventAnimationType) {
    this.animateVentTransition(deltaTime);
  }
  
  private animateVentTransition(deltaTime: number): void {
    const VENT_ANIM_DURATION = 0.3; // 300ms
    this.ventAnimationProgress += deltaTime / VENT_ANIM_DURATION;
    
    if (this.ventAnimationProgress >= 1) {
      this.ventAnimationType = null;
      this.ventAnimationProgress = 0;
      return;
    }
    
    if (this.ventAnimationType === 'entering') {
      // Shrink and move toward vent center
      const scale = 1 - this.ventAnimationProgress;
      this.container.scale.set(scale);
      
      // Move toward vent
      const targetX = this.ventPosition!.x * this.scale;
      const targetY = this.ventPosition!.y * this.scale;
      this.container.x += (targetX - this.container.x) * 0.2;
      this.container.y += (targetY - this.container.y) * 0.2;
    } else {
      // Grow from vent center
      const scale = this.ventAnimationProgress;
      this.container.scale.set(scale);
    }
  }
}
```

---

#### 16. ✅ Handle Player Visibility When In Vent
**Files**: `src/rendering/PlayerRenderer.ts`, `src/rendering/GameRenderer.ts`

```typescript
// In PlayerRenderer.update():
update(player: PlayerSnapshot): void {
  // ... existing code ...
  
  // Handle vent visibility
  if (player.isInVent) {
    // Player is completely hidden when in vent
    this.container.visible = false;
  } else {
    this.container.visible = true;
  }
}

// In GameRenderer - track vent animations
private handleVentEvent(event: VentEvent): void {
  const playerSprite = this.playerRenderer.getSprite(event.playerId);
  const ventSprite = this.objectRenderer.getVentSprite(event.ventId);
  
  if (event.eventType === 'ENTER') {
    playerSprite?.startVentAnimation('entering', event.ventPosition);
    ventSprite?.setAnimationState('opening');
    
    // After animation, hide player
    setTimeout(() => {
      ventSprite?.setAnimationState('closing');
    }, 300);
  } else if (event.eventType === 'EXIT') {
    ventSprite?.setAnimationState('opening');
    playerSprite?.startVentAnimation('exiting', event.ventPosition);
    
    setTimeout(() => {
      ventSprite?.setAnimationState('closing');
    }, 300);
  }
}
```

---

#### 17. ✅ Add Vent Sound Effects
**Files**: `src/rendering/GameRenderer.ts`, `public/audio/`

```typescript
// Add vent sound
private ventSound: HTMLAudioElement;

// In constructor:
this.ventSound = new Audio('/audio/vent.mp3');
this.ventSound.volume = 0.4;

// Play on vent events
private playVentSound(): void {
  // Only play if within hearing range (similar to kill sound)
  this.ventSound.currentTime = 0;
  this.ventSound.play().catch(() => {});
}
```

**Audio file needed**: Create/source a metallic vent opening sound (~0.3s)

---

### Phase 5: Protocol & State Sync (Points 18-20)

#### 18. ✅ Add Vent Events to Protocol
**Files**: `shared/types/protocol.types.ts`

```typescript
// Add vent event to world snapshot
export interface WorldSnapshot {
  // ... existing fields ...
  ventEvents: VentEventSnapshot[];  // Recent vent events for this tick
  playersInVents: string[];         // Player IDs currently in vents
}

export interface VentEventSnapshot {
  id: string;
  timestamp: number;
  playerId: string;
  playerName: string;
  ventId: string;
  ventRoom: string;
  eventType: 'ENTER' | 'EXIT';
  destinationVentId?: string;
  // Don't send witnesses to client - calculated locally
}

// WebSocket message types
export type ServerMessage = 
  | { type: 'world_update', data: WorldSnapshot }
  | { type: 'vent_event', data: VentEventSnapshot }  // Real-time vent notification
  // ... other types
```

---

#### 19. ✅ Update Simulation Serialization
**Files**: `shared/engine/serialization.ts`

```typescript
// Add vent state to player snapshot
export interface PlayerSnapshot {
  // ... existing fields ...
  isInVent: boolean;
  currentVentId: string | null;
  ventAnimationState?: 'entering' | 'exiting' | null;
}

// Serialize vent events
export function serializeVentEvent(event: VentEvent): VentEventSnapshot {
  return {
    id: event.id,
    timestamp: event.timestamp,
    playerId: event.playerId,
    playerName: event.playerName,
    ventId: event.ventId,
    ventRoom: event.ventRoom,
    eventType: event.eventType,
    destinationVentId: event.destinationVentId
  };
}
```

---

#### 20. ✅ Update `agents.md` Implementation Status
**Files**: `agents.md`

Move vent system from "Not Yet Implemented" to "Fully Implemented" section:

```markdown
### ✅ Fully Implemented
| System | Details |
|--------|---------|
| **Vent System** | Impostor-only vent travel, entry/exit animations, witness detection, AI decision support |

### AI Decision Types (Active)
**Impostor-Only Goals:**
```
KILL           - Eliminate a crewmate
HUNT           - Actively seek isolated targets
ENTER_VENT     - Enter nearest accessible vent
EXIT_VENT      - Exit vent at chosen destination  
VENT_TO        - Navigate through vent network to destination
...
```

### Thought Triggers (Active)
```
near_vent           - IMPOSTOR ONLY: Near accessible vent
saw_vent_event      - Witnessed someone use a vent (instant 100% suspicion!)
entered_vent        - Just entered a vent
in_vent_deciding    - Inside vent, choosing exit
exited_vent         - Just emerged from vent
```
```

---

## Implementation Order (Recommended)

### Sprint 1: Core Infrastructure (1-4)
1. Types and interfaces
2. AI goal types
3. VentSystem class
4. Data helper functions

### Sprint 2: Server Logic (5-9)
5. SimulationManager integration
6. AIContext vent data
7. AI prompts
8. Witness detection
9. Memory events

### Sprint 3: AI Brain (10-13)
10. AIAgent vent actions
11. Thought triggers
12. Prompt strategy
13. Response parsing

### Sprint 4: Client Rendering (14-17)
14. VentSprite animations
15. Player vent animations
16. Visibility handling
17. Sound effects

### Sprint 5: Protocol & Polish (18-20)
18. Protocol updates
19. Serialization
20. Documentation

---

## Testing Checklist

- [ ] Impostor can enter vent when in range
- [ ] Impostor cannot enter vent from too far
- [ ] Crewmates cannot enter vents
- [ ] Player disappears when in vent
- [ ] Player can travel between connected vents
- [ ] Player cannot travel to non-connected vents
- [ ] Vent cooldown prevents spam
- [ ] Witnesses within vision see vent usage
- [ ] Witnesses outside vision don't see vent usage
- [ ] Witness sets suspicion to 100%
- [ ] AI chooses appropriate vent strategies
- [ ] Vent animations play correctly
- [ ] Vent sound plays on usage
- [ ] Client receives vent events via WebSocket
- [ ] Player position updates correctly on vent exit

---

## Risk Considerations

### High Risk: False Accusations
Players can claim "I saw X vent!" when they didn't. This creates:
- Social deception opportunities
- He-said-she-said dynamics
- Trust/credibility systems needed

**Mitigation**: Track observation authenticity in memory. If agent claims to see vent but wasn't in vision range, they're lying.

### Medium Risk: Vent Camping
Impostors could stay in vents indefinitely to avoid detection.

**Mitigation**: Add a maximum vent time (e.g., 30 seconds), or make AI evaluate when to exit.

### Low Risk: Animation Desync
Client and server vent animations could get out of sync.

**Mitigation**: Use server timestamps for all vent events, client interpolates.

---

## Dependencies

- ✅ Vision system (for witness detection)
- ✅ Line-of-sight calculations
- ✅ Pathfinding (for distance to vent calculations)
- ✅ AI decision framework
- ✅ WebSocket protocol
- ⬜ Vent sound effect audio file

---

*Document created: [Current Date]*
*Last updated: [Current Date]*
