import type { Point } from '../data/poly3-map.ts';
import type { PlayerActivityState, PlayerLocationState } from '../engine/PlayerStateMachine.ts';
import type { PlayerRole, PlayerState } from './game.types.ts';

// ========== AI Thought & Speech Events ==========

export interface ThoughtEvent {
  id: string;
  agentId: string;
  timestamp: number;
  thought: string;
  trigger: ThoughtTrigger;
  context?: string;
}

export type ThoughtTrigger = 
  | 'arrived_at_destination'
  | 'task_completed'
  | 'task_started'
  | 'agent_spotted'
  | 'agent_lost_sight'
  | 'entered_room'
  | 'idle_random'
  | 'heard_speech'
  | 'passed_agent_closely'
  | 'task_in_action_radius'
  | 'target_entered_kill_range'  // Impostor-only: crewmate just entered kill range
  | 'near_vent'                  // Impostor-only: near a vent, might consider using it
  | 'entered_vent'               // Impostor-only: just entered a vent
  | 'exited_vent'                // Impostor-only: just exited a vent
  | 'witnessed_vent_activity'    // Crewmate/Impostor: saw someone enter/exit a vent
  | 'alone_with_vent'            // Impostor-only: alone in a room with a vent
  | 'witnessed_suspicious_behavior';  // Saw someone acting sus (following, loitering, etc.)

export interface SpeechEvent {
  id: string;
  speakerId: string;
  timestamp: number;
  message: string;
  targetAgentId?: string; // If speaking to specific agent, otherwise broadcast
  position: Point;
  hearingRadius: number;
}

/**
 * Event emitted when an agent hears speech from another agent
 * Used for visual feedback on the client side
 */
export interface HeardSpeechEvent {
  id: string;
  listenerId: string;      // Agent who heard the speech
  listenerName: string;
  speakerId: string;       // Agent who spoke
  speakerName: string;
  timestamp: number;
  message: string;         // What was said (may be truncated)
  distance: number;        // How far away the speaker was
  isDirectlyAddressed: boolean;  // Was the listener mentioned by name?
}

export interface TaskAssignment {
  taskType: string;
  room: string;
  position: Point;
  isCompleted: boolean;
  isFaking: boolean; // For impostors
  startedAt?: number;
  completedAt?: number;
  duration: number; // How long this task takes (ms)
}

// ========== Movement Snapshot ==========

export interface MovementSnapshot {
  position: Point;
  velocity: Point;
  facing: number;
  path: Point[];
  isMoving: boolean;
  speed: number;
}

// ========== Agent Snapshot (Extended for AI) ==========

export interface AgentSnapshot {
  id: string;
  name: string;
  color: number;
  visionRadius: number;
  actionRadius: number;
  movement: MovementSnapshot;
  activityState: PlayerActivityState;
  locationState: PlayerLocationState;
  currentZone: string | null;
  currentGoal: string | null;
  timeInStateMs: number;
  
  // Role & State (AI additions - optional for backward compatibility)
  role?: PlayerRole;
  playerState?: PlayerState;
  
  // Tasks
  assignedTasks?: TaskAssignment[];
  currentTaskIndex?: number | null;
  tasksCompleted?: number;
  
  // AI State
  currentThought?: string | null;
  lastThoughtTime?: number;
  recentSpeech?: string | null;
  lastSpeechTime?: number;
  isThinking?: boolean; // True when agent is waiting for LLM response
  
  // Perception (who this agent can see)
  visibleAgentIds?: string[];
  visibleAgentNames?: string[]; // Color names of visible agents for UI
  
  // Social/Trust (suspicion levels toward other agents)
  suspicionLevels?: Record<string, number>; // agentId -> 0-100
  
  // Memory context for UI
  memoryContext?: string;
  suspicionContext?: string;
  recentConversations?: Array<{
    speakerName: string;
    message: string;
    timestamp: number;
  }>;
  recentlyHeard?: Array<{
    speakerName: string;
    message: string;
    timestamp: number;
    wasDirectlyAddressed: boolean;
  }>;
  isBeingFollowed?: boolean;
  buddyId?: string | null;
  
  // Impostor kill status (only for impostors, for UI display)
  killStatus?: {
    cooldownRemaining: number;  // seconds remaining on cooldown
    canKill: boolean;           // cooldown is ready AND target in range
    hasTargetInRange: boolean;  // target in kill range (regardless of cooldown)
    killCount: number;          // total kills this game
  };

  // Vent status (only for impostors, for UI display)
  ventStatus?: {
    isInVent: boolean;
    currentVentId: string | null;
    ventCooldownRemaining: number; // seconds remaining on cooldown
    ventAnimationState?: 'entering' | 'exiting' | null;
  };

  // God Mode status (for UI display)
  godMode?: {
    isActive: boolean;                    // Currently executing a god command
    guidingPrinciples: string[];          // Persistent behavioral directives
    lastWhisper?: string;                 // Most recent divine whisper
    lastWhisperTimestamp?: number;        // When the whisper was received
    currentCommand?: string;              // Description of current god command
  };
}

export interface AgentSummarySnapshot {
  id: string;
  activityState: PlayerActivityState;
  locationState: PlayerLocationState;
  currentZone: string | null;
  currentGoal: string | null;
}

// ========== Body Snapshot (for dead bodies on the map) ==========

export interface BodySnapshot {
  id: string;
  victimId: string;
  victimName: string;
  victimColor: number;
  position: Point;
  killedAt: number;
  zone: string | null;
  isReported: boolean;
}

// ========== Kill Event Snapshot (for UI notification) ==========

export interface KillEventSnapshot {
  id: string;
  killerName: string;
  victimName: string;
  zone: string | null;
  timestamp: number;
  witnessCount: number;
}

// ========== Vent Event Snapshot (for UI notification) ==========

export interface VentEventSnapshot {
  id: string;
  playerId: string;
  playerName: string;
  ventId: string;
  ventRoom: string;
  eventType: 'ENTER' | 'EXIT' | 'TRAVEL';
  /** For EXIT - where they came from. For TRAVEL - destination */
  relatedVentId?: string;
  ventPosition: Point;
  timestamp: number;
  /** Number of witnesses who saw this event */
  witnessCount: number;
}

// ========== World Snapshot ==========

// ========== Game Timer ==========

export interface GameTimerSnapshot {
  durationMs: number;        // Total game duration (e.g., 600000 for 10 minutes)
  elapsedMs: number;         // Time elapsed since game start
  remainingMs: number;       // Time remaining until reset
  startedAt: number;         // Unix timestamp when game started
}

export interface WorldSnapshot {
  tick: number;
  timestamp: number;
  gamePhase?: 'INITIALIZING' | 'PLAYING' | 'MEETING' | 'GAME_OVER';
  gameTimer?: GameTimerSnapshot; // Game timer info for UI and agents
  agents: AgentSnapshot[];
  bodies?: BodySnapshot[]; // Dead bodies on the map
  recentKills?: KillEventSnapshot[]; // Recent kill events for UI
  recentVentEvents?: VentEventSnapshot[]; // Recent vent events for UI
  playersInVents?: string[]; // Player IDs currently in vents
  recentThoughts?: ThoughtEvent[];
  recentSpeech?: SpeechEvent[];
  recentHeard?: HeardSpeechEvent[];  // Recent hearing events for visual feedback
  taskProgress?: number; // 0-100 percentage of total tasks completed
  llmQueueStats?: import('./protocol.types.ts').LLMQueueStats; // LLM queue monitoring
}

// ========== AI Decision Types ==========

export type AIGoalType = 
  | 'GO_TO_TASK' 
  | 'WANDER' 
  | 'FOLLOW_AGENT' 
  | 'AVOID_AGENT' 
  | 'IDLE' 
  | 'SPEAK' 
  | 'BUDDY_UP' 
  | 'CONFRONT' 
  | 'SPREAD_RUMOR' 
  | 'DEFEND_SELF'
  // Impostor-only actions
  | 'KILL'
  | 'HUNT'           // Actively seek isolated targets
  | 'SELF_REPORT'    // Report own kill
  | 'FLEE_BODY'      // Get away from body
  | 'CREATE_ALIBI'   // Position near witnesses/tasks after kill
  // Vent actions (Impostor-only)
  | 'ENTER_VENT'     // Go to and enter nearest accessible vent
  | 'EXIT_VENT'      // Exit current vent at chosen destination
  | 'VENT_TO';       // Navigate through vent network to specific destination

export interface AIDecision {
  goalType: AIGoalType;
  targetTaskIndex?: number;
  targetAgentId?: string;
  targetPosition?: Point;
  reasoning: string;
  thought?: string;
  speech?: string;
  // Social context
  accusation?: string; // For CONFRONT - what to accuse
  rumor?: string; // For SPREAD_RUMOR - what to spread
  defense?: string; // For DEFEND_SELF - alibi/defense statement
  // Kill context (impostor only)
  killTarget?: string; // Agent ID to kill
  // Vent context (impostor only)
  targetVentId?: string; // Vent ID for ENTER_VENT, EXIT_VENT, VENT_TO
}

export interface AIContext {
  agentId: string;
  agentName: string;
  role: PlayerRole;
  currentZone: string | null;
  currentPosition: Point;
  assignedTasks: TaskAssignment[];
  currentTaskIndex: number | null;
  visibleAgents: Array<{
    id: string;
    name: string;
    zone: string | null;
    distance: number;
    activityState?: string;
    role?: PlayerRole; // Only visible to impostor for fellow impostors
    isAlive?: boolean;
  }>;
  suspicionLevels: Record<string, number>;
  recentEvents: string[];
  canSpeakTo: string[]; // Agent IDs within speech range
  // Enhanced memory context
  memoryContext?: string; // Summary of relevant memories
  suspicionContext?: string; // Detailed suspicion reasoning
  recentConversations?: Array<{
    speakerName: string;
    message: string;
    timestamp: number;
  }>;
  isBeingFollowed?: boolean;
  buddyId?: string | null;
  
  // ===== Current Goal/Hunt Tracking (for persistent behaviors) =====
  currentGoalType?: AIGoalType;
  huntTargetId?: string;      // ID of agent being hunted
  huntTargetName?: string;    // Name of agent being hunted (for display)

  // ===== Game Timer Context (for urgency-aware decisions) =====
  gameTimer?: {
    remainingMs: number;         // Time remaining in the round
    elapsedMs: number;           // Time elapsed since round start
    timeSinceLastDecisionMs: number; // Time since this agent's last decision
  };
  
  // ===== Impostor-specific context (only provided when role is IMPOSTOR) =====
  impostorContext?: {
    killCooldownRemaining: number; // seconds
    canKill: boolean;
    targetsInKillRange: Array<{
      id: string;
      name: string;
      distance: number;
      isIsolated: boolean; // No other witnesses nearby
      witnessCount?: number; // Number of potential witnesses if not isolated
      zone: string | null;
    }>;
    recentKillTime: number | null; // timestamp of last kill
    killCount: number;
    fellowImpostors: Array<{ id: string; name: string }>; // Other impostors (ID and color name)
    nearbyBodies: Array<{
      id: string;
      victimName: string;
      distance: number;
      zone: string | null;
    }>;
  };

  // ===== Vent context (only provided when role is IMPOSTOR) =====
  ventContext?: {
    isInVent: boolean;
    currentVentId: string | null;
    /** Connected vents if currently in a vent */
    connectedVents: Array<{
      id: string;
      room: string;
      /** Risk of being seen when exiting (0-100) */
      witnessRisk: number;
    }>;
    /** Nearby vents if not in a vent */
    nearbyVents: Array<{
      id: string;
      room: string;
      distance: number;
      /** Can enter (within interaction range) */
      canEnter: boolean;
      /** Risk of being seen when entering (0-100) */
      witnessRisk: number;
    }>;
    /** Cooldown remaining before can use vent again */
    ventCooldownRemaining: number;
  };
  
  // ===== Body/witness context (for both roles) =====
  visibleBodies?: Array<{
    id: string;
    victimName: string;
    victimColor: number;
    position: Point;
    distance: number;
    zone: string | null;
  }>;
  
  // Witness memory - what this agent saw related to kills
  witnessMemory?: {
    sawKill: boolean;
    sawBody: boolean;
    suspectedKillerColor: number | null;
    colorConfidence: number;
    location: string | null;
    timestamp: number;
  } | null;

  // ===== Pending conversation reply - speech this agent just heard =====
  pendingReply?: {
    speakerId: string;
    speakerName: string;
    message: string;
    zone: string | null;
    timestamp: number;
  } | null;
  // Enhanced heard speech context for thought generation
  heardSpeechFrom?: string;     // Name of who spoke
  heardSpeechMessage?: string;  // What they said

  // ===== Recently heard messages (for context in prompts) =====
  recentlyHeard?: Array<{
    speakerName: string;
    message: string;
    timestamp: number;
    wasDirectlyAddressed: boolean;
  }>;

  // ===== God Mode context (divine intervention from observer) =====
  godMode?: {
    /** Divine whisper to inject into next prompt (one-time use) */
    whisper: string | null;
    /** Persistent guiding principles for all prompts */
    guidingPrinciples: string[];
  };
}
