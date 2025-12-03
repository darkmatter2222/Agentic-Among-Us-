import type { Point } from '../data/poly3-map.ts';
import type { PlayerActivityState, PlayerLocationState } from '../engine/PlayerStateMachine.ts';
import type { PlayerRole, PlayerState, MeetingSnapshot, MeetingPhase } from './game.types.ts';

// Re-export meeting types for consumers
export type { MeetingSnapshot, MeetingPhase };

// ========== AI Thought & Speech Events ==========

export interface ThoughtEvent {
  id: string;
  agentId: string;
  timestamp: number;
  thought: string;
  trigger: ThoughtTrigger;
  context?: string;
  // Enhanced thought processing - extracted from LLM JSON response
  suspicionUpdates?: SuspicionUpdate[];
  pendingQuestions?: PendingQuestion[];
}

// Suspicion update from a thought - agent wants to adjust their suspicion of another player
export interface SuspicionUpdate {
  targetName: string;      // Color name of the player (e.g., "Red", "Blue")
  delta: number;           // Change in suspicion (-20 to +20)
  reason: string;          // Brief reason for the change
}

// Question the agent wants to ask when encountering a specific player
export interface PendingQuestion {
  targetName: string;      // Who to ask (color name)
  question: string;        // What to ask them
  priority: 'low' | 'medium' | 'high';  // How important is this question
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
  | 'witnessed_suspicious_behavior'  // Saw someone acting sus (following, loitering, etc.)
  | 'witnessed_body';                // Found a dead body - triggers REPORT_BODY goal

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
  personalityId?: string; // Personality archetype for this agent

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

  // Full memory dump for UI display
  fullMemory?: {
    observations: Array<{
      id: string;
      timestamp: number;
      type: string;
      subjectName: string;
      zone: string | null;
      description: string;
    }>;
    conversations: Array<{
      id: string;
      timestamp: number;
      speakerName: string;
      message: string;
      zone: string | null;
    }>;
    accusations: Array<{
      id: string;
      timestamp: number;
      accuserName: string;
      accusedName: string;
      reason: string;
    }>;
    alibis: Array<{
      id: string;
      timestamp: number;
      agentName: string;
      claimedZone: string;
      claimedActivity: string;
    }>;
    suspicionRecords: Array<{
      agentId: string;
      agentName: string;
      level: number;
      reasons: Array<{ reason: string; delta: number; category: string }>;
    }>;
    // Indexed access for UI display
    suspicionReasons?: Record<string, string[]>;
    lastKnownLocations?: Record<string, { zone: string; timestamp: number }>;
  };

  // Pending questions this agent wants to ask other players
  pendingQuestions?: PendingQuestion[];
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

// ========== Game Phase Types ==========

/**
 * Game phases for the body discovery mechanic:
 * - WORKING: Pre-discovery phase. Crewmates are just workers doing their shift.
 *            No one knows there's danger. Mundane conversations about tasks and work.
 * - ALERT: Post-first-body-discovery phase. Crewmates now know there's a killer.
 *          Suspicion, alibis, accusations become relevant.
 * - MEETING: Emergency meeting or body report discussion. Players are teleported
 *            to cafeteria for discussion and voting. See MeetingPhase for sub-states.
 * - GAME_OVER: Game has ended
 */
export type GamePhase = 'WORKING' | 'ALERT' | 'MEETING' | 'GAME_OVER';

/**
 * Reason the game ended - used for victory/defeat screens
 */
export type GameEndReason =
  | 'ONGOING'              // Game still in progress
  | 'CREW_WIN_TASKS'       // Crewmates completed all tasks
  | 'CREW_WIN_VOTE'        // Crewmates voted out all impostors (future)
  | 'IMP_WIN_PARITY'       // Impostors reached numerical parity
  | 'IMP_WIN_SABOTAGE'     // Crewmates failed to fix critical sabotage
  | 'TIME_UP';             // Game timer expired with no winner

/**
 * Game end state snapshot for UI
 */
export interface GameEndState {
  reason: GameEndReason;
  winner: 'CREWMATES' | 'IMPOSTORS' | 'NONE';
  /** Names of surviving crewmates */
  survivingCrewmates: string[];
  /** Names of surviving impostors */
  survivingImpostors: string[];
  /** Names of all impostors (revealed at end) */
  impostorReveal: string[];
  /** Final task progress percentage */
  taskProgress: number;
  /** Total kills this match */
  totalKills: number;
  /** Match duration in ms */
  matchDuration: number;
  /** Countdown to next match (ms) */
  nextMatchCountdown: number;
}

/**
 * Event emitted when a body is reported
 */
export interface BodyReportEvent {
  reporterId: string;
  reporterName: string;
  /** All bodies being reported (multiple may exist) */
  bodies: Array<{
    victimId: string;
    victimName: string;
    victimColor: number;
    location: string | null;
  }>;
  timestamp: number;
  /** True if this is the first body ever discovered (triggers phase transition) */
  isFirstDiscovery: boolean;
}

export interface WorldSnapshot {
  tick: number;
  timestamp: number;
  gamePhase?: GamePhase;
  gameTimer?: GameTimerSnapshot; // Game timer info for UI and agents
  /** Game end state - present when game is over */
  gameEndState?: GameEndState;
  /** True if at least one body has been discovered this game */
  firstBodyDiscovered?: boolean;
  /** Most recent body report event (for UI animation) */
  recentBodyReport?: BodyReportEvent;
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
  // Sabotage state
  sabotageState?: SabotageSnapshot;
  
  // Meeting state (when gamePhase === 'MEETING')
  /** Active meeting snapshot for UI rendering */
  activeMeeting?: MeetingSnapshot;
  /** Current phase within the meeting */
  meetingPhase?: MeetingPhase;
}

// ========== Sabotage Snapshot ==========

export interface SabotageSnapshot {
  /** Currently active sabotage, if any */
  activeSabotage?: {
    type: 'LIGHTS' | 'REACTOR' | 'O2' | 'COMMS';
    timeRemaining: number;  // Seconds remaining for critical sabotages
    fixProgress: number;    // 0-100 progress on fix
    /** Fix locations for this sabotage */
    fixLocations: Array<{
      id: string;
      position: { x: number; y: number };
      isFixed: boolean;
    }>;
  };
  /** Whether lights are currently on */
  lightsOn: boolean;
  /** Whether comms are currently active */
  commsActive: boolean;
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
  | 'REPORT_BODY'    // Report a dead body (triggers meeting)
  | 'FIX_SABOTAGE'   // Go to fix location to repair sabotage (crewmate)
  // Meeting actions
  | 'CALL_EMERGENCY_MEETING'  // Go to emergency button and call meeting
  // Impostor-only actions
  | 'KILL'
  | 'HUNT'           // Actively seek isolated targets
  | 'SELF_REPORT'    // Report own kill
  | 'FLEE_BODY'      // Get away from body
  | 'CREATE_ALIBI'   // Position near witnesses/tasks after kill
  // Vent actions (Impostor-only)
  | 'ENTER_VENT'     // Go to and enter nearest accessible vent
  | 'EXIT_VENT'      // Exit current vent at chosen destination
  | 'VENT_TO'        // Navigate through vent network to specific destination
  // Sabotage actions (Impostor-only)
  | 'SABOTAGE_LIGHTS'    // Sabotage the lights to reduce crewmate vision
  | 'SABOTAGE_REACTOR'   // Sabotage reactor (critical - forces crewmates to fix)
  | 'SABOTAGE_O2'        // Sabotage O2 (critical - forces crewmates to fix)
  | 'SABOTAGE_COMMS';    // Sabotage comms (hides task list)

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
  // Sabotage context (impostor only)
  sabotageType?: 'LIGHTS' | 'REACTOR' | 'O2' | 'COMMS';
}

export interface AIContext {
  agentId: string;
  agentName: string;
  role: PlayerRole;
  personalityId?: string; // Personality archetype for this agent
  /** Current game phase - affects how crewmates think and communicate */
  gamePhase?: GamePhase;
  /** True if at least one body has been discovered (crewmates now know danger exists) */
  firstBodyDiscovered?: boolean;
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

  // ===== Sabotage context (only provided when role is IMPOSTOR) =====
  sabotageContext?: {
    /** Currently active sabotage if any */
    activeSabotage: { type: 'LIGHTS' | 'REACTOR' | 'O2' | 'COMMS'; remainingTime: number } | null;
    /** Cooldown remaining before can sabotage again */
    cooldownRemaining: number;
    /** Can start a new sabotage */
    canSabotage: boolean;
    /** Available sabotage types to trigger */
    availableSabotages: Array<'LIGHTS' | 'REACTOR' | 'O2' | 'COMMS'>;
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

  // ===== Body Discovery context (for immediate decisions when finding a body) =====
  /** True when this decision is being made because agent just discovered a body */
  bodyDiscoveryContext?: boolean;

  // ===== JSON-formatted context for enhanced thought processing =====
  /** Suspicions in JSON format for structured LLM responses */
  suspicionContextJSON?: object;
  /** Recent memories in JSON format for structured LLM responses */
  memoryContextJSON?: object;
  /** Pending questions from previous thoughts (things agent wants to ask) */
  pendingQuestions?: PendingQuestion[];
}
