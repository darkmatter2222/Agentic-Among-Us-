/**
 * Core type definitions for Among Us AI Agent Simulation
 * Based on comprehensive game mechanics research
 */

// ========== ENUMS ==========

export const PlayerRole = {
  CREWMATE: 'CREWMATE',
  IMPOSTOR: 'IMPOSTOR'
} as const;
export type PlayerRole = typeof PlayerRole[keyof typeof PlayerRole];

export const PlayerState = {
  ALIVE: 'ALIVE',
  DEAD: 'DEAD',
  GHOST: 'GHOST'
} as const;
export type PlayerState = typeof PlayerState[keyof typeof PlayerState];

export const TaskType = {
  SHORT: 'SHORT',
  LONG: 'LONG',
  COMMON: 'COMMON',
  VISUAL: 'VISUAL'
} as const;
export type TaskType = typeof TaskType[keyof typeof TaskType];

export const SabotageType = {
  REACTOR: 'REACTOR',
  OXYGEN: 'OXYGEN',
  LIGHTS: 'LIGHTS',
  COMMUNICATIONS: 'COMMUNICATIONS',
  DOORS: 'DOORS'
} as const;
export type SabotageType = typeof SabotageType[keyof typeof SabotageType];

export const GamePhase = {
  PLAYING: 'PLAYING',
  DISCUSSION: 'DISCUSSION',
  VOTING: 'VOTING',
  GAME_OVER: 'GAME_OVER'
} as const;
export type GamePhase = typeof GamePhase[keyof typeof GamePhase];

export const MeetingType = {
  EMERGENCY: 'EMERGENCY',
  BODY_REPORT: 'BODY_REPORT'
} as const;
export type MeetingType = typeof MeetingType[keyof typeof MeetingType];

// Meeting phase within a meeting
export const MeetingPhase = {
  PRE_MEETING: 'PRE_MEETING',     // Brief pause before discussion starts
  DISCUSSION: 'DISCUSSION',       // Players discuss, no voting yet
  VOTING: 'VOTING',               // Players can cast votes
  VOTE_RESULTS: 'VOTE_RESULTS',   // Showing vote tally
  EJECTION: 'EJECTION'            // Ejection animation playing
} as const;
export type MeetingPhase = typeof MeetingPhase[keyof typeof MeetingPhase];

export const ActionType = {
  MOVE: 'MOVE',
  DO_TASK: 'DO_TASK',
  KILL: 'KILL',
  VENT: 'VENT',
  SABOTAGE: 'SABOTAGE',
  REPORT: 'REPORT',
  EMERGENCY_MEETING: 'EMERGENCY_MEETING',
  WAIT: 'WAIT'
} as const;
export type ActionType = typeof ActionType[keyof typeof ActionType];

export const KnownInfoType = {
  TASK_SEEN: 'TASK_SEEN',
  PLAYER_LOCATION: 'PLAYER_LOCATION',
  BODY_FOUND: 'BODY_FOUND',
  VENT_SEEN: 'VENT_SEEN',
  KILL_WITNESSED: 'KILL_WITNESSED',
  VISUAL_TASK_VERIFIED: 'VISUAL_TASK_VERIFIED',
  PLAYER_CLEARED: 'PLAYER_CLEARED',
  SUSPICIOUS_BEHAVIOR: 'SUSPICIOUS_BEHAVIOR'
} as const;
export type KnownInfoType = typeof KnownInfoType[keyof typeof KnownInfoType];

// ========== BASIC TYPES ==========

export interface Position {
  x: number;
  y: number;
}

export interface Velocity {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ========== TASK SYSTEM ==========

export interface Task {
  id: string;
  name: string;
  type: TaskType;
  location: string; // Room ID
  position: Position;
  duration: number; // milliseconds
  isVisual: boolean;
  isCompleted: boolean;
  isMultiStage?: boolean;
  stages?: TaskStage[];
  currentStage?: number;
}

export interface TaskStage {
  location: string;
  duration: number;
  description: string;
}

export interface TaskProgress {
  taskId: string;
  playerId: string;
  startTime: number;
  progress: number; // 0-1
  isActive: boolean;
}

// ========== PLAYER SYSTEM ==========

export interface Player {
  id: string;
  name: string;
  role: PlayerRole;
  state: PlayerState;
  position: Position;
  velocity: Velocity;
  targetPosition?: Position;
  color: string;
  
  // Vision & Movement
  visionRadius: number;
  speed: number;
  
  // Tasks
  tasks: Task[];
  currentTask?: string; // Task ID
  taskProgress?: TaskProgress;
  
  // Impostor Abilities
  killCooldown: number; // seconds
  lastKillTime: number;
  killRange: number; // units
  isInVent: boolean;
  currentVent?: string; // Vent ID
  
  // Meeting & Voting
  emergencyMeetingsRemaining: number;
  hasVoted: boolean;
  votedFor?: string; // Player ID or 'SKIP'
  
  // AI Memory & Suspicion
  suspicionLevels: Map<string, number>; // player_id -> 0-100
  knownInformation: KnownInfo[];
  trustNetwork: Map<string, number>; // player_id -> -100 to 100
  lastSeenLocations: Map<string, LocationMemory>; // player_id -> location
  
  // AI Decision State
  currentGoal?: AgentGoal;
  planningQueue: AgentAction[];
}

export interface LocationMemory {
  location: string;
  timestamp: number;
  position: Position;
}

export interface KnownInfo {
  id: string;
  timestamp: number;
  type: KnownInfoType;
  playerId?: string;
  location?: string;
  position?: Position;
  details: string;
  reliability: number; // 0-1 (how confident the agent is)
}

export interface AgentGoal {
  type: 'COMPLETE_TASK' | 'FIND_SAFE_AREA' | 'FOLLOW_PLAYER' | 'KILL_TARGET' | 'CREATE_ALIBI' | 'SABOTAGE';
  priority: number;
  targetId?: string;
  targetLocation?: string;
  reasoning: string;
}

export interface AgentAction {
  type: ActionType;
  targetPosition?: Position;
  targetId?: string; // Player, Task, or Vent ID
  duration?: number;
  reasoning: string;
}

// ========== MAP SYSTEM ==========

export interface Room {
  id: string;
  name: string;
  position: Position;
  width: number;
  height: number;
  tasks: Task[];
  vents: Vent[];
  entrances: Position[];
  walls: Wall[];
  isDeadEnd: boolean;
  isDangerous: boolean; // High kill frequency
  cameraId?: string;
}

export interface Wall {
  start: Position;
  end: Position;
}

export interface Vent {
  id: string;
  position: Position;
  connectedVents: string[]; // Vent IDs
  room: string; // Room ID
}

export interface Door {
  id: string;
  position: Position;
  start: Position;
  end: Position;
  orientation: 'horizontal' | 'vertical';
  room1: string;
  room2: string;
  isOpen: boolean;
  isSabotaged: boolean;
  sabotageStartTime?: number;
}

export interface Camera {
  id: string;
  position: Position;
  viewingAngle: number;
  viewingDistance: number;
  coverageArea: Bounds;
  isActive: boolean;
}

// ========== SABOTAGE SYSTEM ==========

export interface ActiveSabotage {
  type: SabotageType;
  startTime: number;
  duration: number; // milliseconds
  isFixed: boolean;
  fixLocations?: Position[]; // For reactor/oxygen
  fixedLocations?: boolean[]; // Track which locations are fixed
  affectedDoors?: string[]; // Door IDs for door sabotage
}

export interface SabotageAction {
  type: SabotageType;
  triggeredBy: string; // Player ID
  timestamp: number;
  targetDoors?: string[]; // For door sabotage
}

// ========== MEETING & VOTING SYSTEM ==========

export interface Meeting {
  id: string;
  type: MeetingType;
  phase: MeetingPhase;
  calledBy: string; // Player ID
  calledByName: string; // Player name for display
  calledAt: number;
  
  // Body report info (if type === BODY_REPORT)
  bodyId?: string;
  bodyLocation?: Position;
  bodyVictimId?: string;
  bodyVictimName?: string;
  bodyVictimColor?: number;
  bodyZone?: string; // Room name where body was found

  // Timing
  discussionDuration: number; // seconds
  votingDuration: number; // seconds
  discussionEndTime: number;
  votingEndTime: number;
  phaseEndTime: number; // Current phase end time (ms timestamp)

  // Participants (living players at meeting start)
  participants: string[]; // Player IDs who can vote
  
  // Communication
  statements: Statement[];
  votes: VoteRecord[];

  // Results (populated after voting ends)
  result?: EjectionResult;
  ejectedPlayer?: string;
  voteResults?: Map<string, number>; // player_id -> vote count
  wasImpostor?: boolean;
}export interface Statement {
  id: string;
  playerId: string;
  content: string;
  timestamp: number;
  responses: Response[];
  accusesPlayer?: string;
  defendsPlayer?: string;
  claimsLocation?: string;
  claimsTask?: string;
}

export interface Response {
  id: string;
  playerId: string;
  statementId: string;
  content: string;
  timestamp: number;
  isAgreement: boolean;
  isDisagreement: boolean;
}

export interface VoteRecord {
  voterId: string;
  targetId: string | 'SKIP';
  timestamp: number;
  reasoning: string;
  isPublic: boolean; // For anonymous voting
}

// Result of vote tallying
export interface EjectionResult {
  /** Player ID who was ejected, or null if no ejection */
  ejectedPlayerId: string | null;
  /** Name of ejected player for display */
  ejectedPlayerName: string | null;
  /** Why the ejection happened (or didn't) */
  reason: 'MAJORITY' | 'PLURALITY' | 'TIE' | 'SKIP_MAJORITY' | 'NO_VOTES';
  /** True if ejected player was an impostor */
  wasImpostor: boolean;
  /** Number of impostors remaining after ejection */
  impostorsRemaining: number;
  /** Vote counts per player/skip */
  voteCounts: Map<string, number>;
  /** Total votes cast */
  totalVotes: number;
}

// ========== MEETING SNAPSHOT (for client sync) ==========

/** Participant info for meeting UI */
export interface MeetingParticipant {
  id: string;
  name: string;
  color: number;
  isAlive: boolean;
  isGhost: boolean;
  hasVoted: boolean;
}

/** Statement as sent to client */
export interface StatementSnapshot {
  id: string;
  playerId: string;
  playerName: string;
  playerColor: number;
  content: string;
  timestamp: number;
  accusesPlayer?: string;
  defendsPlayer?: string;
}

/** Snapshot of meeting state for client rendering */
export interface MeetingSnapshot {
  id: string;
  type: MeetingType;
  phase: MeetingPhase;
  
  // Who called the meeting
  calledById: string;
  calledByName: string;
  calledByColor: number;
  
  // Body report info (if applicable)
  bodyReport?: {
    victimId: string;
    victimName: string;
    victimColor: number;
    location: string; // Zone name
  };
  
  // Timing (ms timestamps)
  discussionEndTime: number;
  votingEndTime: number;
  phaseEndTime: number;
  timeRemaining: number; // Seconds remaining in current phase
  
  // Participants
  participants: MeetingParticipant[];
  votedPlayerIds: string[]; // IDs of players who have voted
  
  // Statements made during discussion
  statements: StatementSnapshot[];
  
  // Vote results (only shown after voting ends, respects anonymous setting)
  voteResults?: {
    voteCounts: Record<string, number>; // targetId -> count (uses 'SKIP' key for skips)
    anonymousVoting: boolean;
    voterMap?: Record<string, string>; // voterId -> targetId (only if not anonymous)
  };
  
  // Ejection info (only during EJECTION phase)
  ejection?: {
    ejectedId: string | null;
    ejectedName: string | null;
    ejectedColor: number | null;
    wasImpostor: boolean;
    impostorsRemaining: number;
    message: string; // Display message like "X was An Impostor"
  };
}

// ========== EMERGENCY BUTTON STATE ==========

/** State tracking for the emergency button */
export interface EmergencyButtonState {
  /** Timestamp when global cooldown expires (game start cooldown) */
  globalCooldownUntil: number;
  /** Per-player cooldown timestamps (after they call a meeting) */
  playerCooldowns: Map<string, number>;
  /** Number of emergency meetings each player has used */
  playerUsageCount: Map<string, number>;
  /** Maximum meetings allowed per player per game */
  meetingsPerPlayer: number;
  /** Cooldown duration in seconds after calling a meeting */
  cooldownDuration: number;
}

export interface DeadBody {
  id: string;
  playerId: string;
  position: Position;
  killedAt: number;
  killedBy: string; // Player ID
  foundBy?: string;
  reportedBy?: string;
  reportedAt?: number;
}

// ========== GAME STATE ==========

export interface GameState {
  // Game Info
  gameId: string;
  phase: GamePhase;
  startTime: number;
  currentTime: number;
  
  // Players & Entities
  players: Map<string, Player>;
  bodies: DeadBody[];
  
  // Map & Environment
  rooms: Room[];
  vents: Vent[];
  doors: Door[];
  cameras: Camera[];
  
  // Active Systems
  activeSabotage?: ActiveSabotage;
  activeMeeting?: Meeting;
  
  // Game Progress
  taskProgress: number; // 0-100
  totalTasks: number;
  completedTasks: number;
  
  // Game Settings
  settings: GameSettings;
  
  // Win Condition
  winner?: 'CREWMATES' | 'IMPOSTORS';
  gameOverReason?: string;
  
  // History & Analytics
  events: GameEvent[];
  killHistory: KillEvent[];
  meetingHistory: Meeting[];
}

export interface GameSettings {
  // Player counts
  totalPlayers: number;
  impostorCount: number;
  
  // Movement & Vision
  playerSpeed: number; // 0.5x - 3.0x
  crewmateVision: number; // 0.25x - 5.0x
  impostorVision: number; // 0.25x - 5.0x
  
  // Kill settings
  killCooldown: number; // 10-60 seconds
  killDistance: 'short' | 'medium' | 'long';
  
  // Task settings
  commonTasks: number; // 0-2
  longTasks: number; // 0-3
  shortTasks: number; // 0-5
  visualTasksEnabled: boolean;
  taskBarUpdates: 'always' | 'meetings' | 'never';
  
  // Meeting settings
  emergencyMeetingsPerPlayer: number; // 1-9
  emergencyCooldown: number; // 0-60 seconds
  discussionTime: number; // 0-120 seconds
  votingTime: number; // 0-300 seconds
  anonymousVoting: boolean;
  confirmEjects: boolean;
  voteLockTime: number; // Seconds before voting ends when votes lock (typically 5)
  
  // Game behavior
  visualTasksOn: boolean;
  
  // AI Settings
  aiThinkingDelay: number; // milliseconds
  simulationSpeed: number; // 1x, 2x, 10x, etc.
}

export interface GameEvent {
  id: string;
  type: 'KILL' | 'TASK_COMPLETE' | 'SABOTAGE' | 'MEETING_CALLED' | 'VOTE' | 'EJECT' | 'VENT' | 'BODY_REPORT';
  timestamp: number;
  playerId?: string;
  details: Record<string, any>;
  location?: Position;
}

export interface KillEvent {
  id: string;
  killerId: string;
  victimId: string;
  location: Position;
  timestamp: number;
  witnessed: boolean;
  witnesses?: string[];
  reported: boolean;
  reportedAt?: number;
  reportedBy?: string;
}

// ========== PATHFINDING ==========

export interface PathNode {
  position: Position;
  gCost: number; // Distance from start
  hCost: number; // Estimated distance to end
  fCost: number; // Total cost (g + h)
  parent?: PathNode;
  room?: string;
}

export interface Path {
  nodes: Position[];
  totalDistance: number;
  estimatedTime: number; // seconds
  isValid: boolean;
  avoidsDanger?: boolean;
}

// ========== AI PERCEPTION ==========

export interface PerceptionData {
  visiblePlayers: VisiblePlayer[];
  visibleBodies: DeadBody[];
  visibleTasks: Task[];
  visibleVents: Vent[];
  currentRoom: string;
  nearbyRooms: string[];
  canReachEmergencyButton: boolean;
  isInDanger: boolean;
  dangerLevel: number; // 0-100
}

export interface VisiblePlayer {
  playerId: string;
  position: Position;
  isDoingTask: boolean;
  taskLocation?: string;
  distanceFromMe: number;
  isInSameRoom: boolean;
  lastSeen: number;
  movementPattern?: 'stationary' | 'walking' | 'running' | 'suspicious';
}

// ========== EXPORTS ==========

export type PlayerId = string;
export type TaskId = string;
export type RoomId = string;
export type VentId = string;
export type MeetingId = string;
export type EventId = string;
