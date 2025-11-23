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
  calledBy: string; // Player ID
  calledAt: number;
  bodyId?: string; // If body report
  bodyLocation?: Position;
  
  // Phases
  discussionDuration: number; // seconds
  votingDuration: number; // seconds
  discussionEndTime: number;
  votingEndTime: number;
  
  // Communication
  statements: Statement[];
  votes: VoteRecord[];
  
  // Results
  ejectedPlayer?: string;
  voteResults?: Map<string, number>; // player_id -> vote count
  wasImpostor?: boolean;
}

export interface Statement {
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
