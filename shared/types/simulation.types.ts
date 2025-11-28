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
  | 'task_in_action_radius';

export interface SpeechEvent {
  id: string;
  speakerId: string;
  timestamp: number;
  message: string;
  targetAgentId?: string; // If speaking to specific agent, otherwise broadcast
  position: Point;
  hearingRadius: number;
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
  isBeingFollowed?: boolean;
  buddyId?: string | null;
  
  // Impostor kill status (only for impostors, for UI display)
  killStatus?: {
    cooldownRemaining: number;  // seconds remaining on cooldown
    canKill: boolean;           // cooldown is ready AND target in range
    hasTargetInRange: boolean;  // target in kill range (regardless of cooldown)
    killCount: number;          // total kills this game
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
  recentThoughts?: ThoughtEvent[];
  recentSpeech?: SpeechEvent[];
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
  | 'CREATE_ALIBI';  // Position near witnesses/tasks after kill

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
}
