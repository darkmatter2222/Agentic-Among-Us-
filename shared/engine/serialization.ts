import type { AIAgent } from './AIAgent.ts';
import type { MovementState } from './MovementController.ts';
import type { PlayerStateMachineState } from './PlayerStateMachine.ts';
import type { DeadBody, KillEvent } from './KillSystem.ts';
import type { VentEvent } from './VentSystem.ts';
import type {
  AgentSnapshot,
  AgentSummarySnapshot,
  MovementSnapshot,
  WorldSnapshot,
  ThoughtEvent,
  SpeechEvent,
  BodySnapshot,
  KillEventSnapshot,
} from '../types/simulation.types.ts';

function serializeMovementState(state: MovementState): MovementSnapshot {
  return {
    position: { ...state.currentPosition },
    velocity: { ...state.velocity },
    facing: state.facing,
    path: state.path.map(point => ({ ...point })),
    isMoving: state.isMoving,
    speed: state.speed,
  };
}

function serializeStateMachineState(state: PlayerStateMachineState, timestamp: number) {
  return {
    activityState: state.activityState,
    locationState: state.locationState,
    currentZone: state.currentZone,
    timeInStateMs: timestamp - state.lastStateChange,
  };
}

export function serializeAgent(agent: AIAgent, timestamp: number, killStatus?: KillStatusInfo): AgentSnapshot {
  const movementState = agent.getMovementController().getState();
  const stateMachineState = agent.getStateMachine().getState();

  const summary = serializeStateMachineState(stateMachineState, timestamp);
  const movement = serializeMovementState(movementState);

  // Get recent conversations from memory
  const recentConversations = agent.getRecentConversations ?
    agent.getRecentConversations().map(conv => ({
      speakerName: conv.speakerName,
      message: conv.message,
      timestamp: conv.timestamp,
    })) : [];

  // Get the actual player alive/dead state from AIAgent (not state machine)
  const playerAliveDeadState = agent.getPlayerState();

  return {
    id: agent.getId(),
    name: agent.getName(),
    color: agent.getColor(),
    visionRadius: agent.getVisionRadius(),
    actionRadius: agent.getActionRadius(),
    movement,
    activityState: summary.activityState,
    locationState: summary.locationState,
    currentZone: summary.currentZone,
    currentGoal: agent.getCurrentGoal(),
    timeInStateMs: summary.timeInStateMs,

    // AI State
    role: agent.getRole(),
    playerState: playerAliveDeadState,
    assignedTasks: agent.getAssignedTasks(),
    currentTaskIndex: agent.getCurrentTaskIndex(),
    tasksCompleted: agent.getTasksCompleted(),
    
    // Thoughts & Speech
    currentThought: agent.getCurrentThought(),
    lastThoughtTime: agent.getLastThoughtTime(),
    recentSpeech: agent.getRecentSpeech(),
    lastSpeechTime: agent.getLastSpeechTime(),
    isThinking: agent.getIsThinking(),
    
    // Perception
    visibleAgentIds: agent.getVisibleAgentIds(),
    visibleAgentNames: agent.getVisibleAgentNames(),
    suspicionLevels: agent.getSuspicionLevels(),
    
    // Memory context for UI
    memoryContext: agent.getMemoryContext ? agent.getMemoryContext() : undefined,
    suspicionContext: agent.getSuspicionContext ? agent.getSuspicionContext() : undefined,
    recentConversations,
    isBeingFollowed: typeof agent.isBeingFollowed === 'function' ? agent.isBeingFollowed() : false,
    buddyId: agent.getBuddyId ? agent.getBuddyId() : null,
    
    // Kill status (impostors only)
    killStatus: killStatus,
  };
}

export function serializeAgentSummary(agent: AIAgent): AgentSummarySnapshot {
  const state = agent.getStateMachine().getState();
  return {
    id: agent.getId(),
    activityState: state.activityState,
    locationState: state.locationState,
    currentZone: state.currentZone,
    currentGoal: agent.getCurrentGoal(),
  };
}

export interface KillStatusInfo {
  cooldownRemaining: number;
  canKill: boolean;
  hasTargetInRange: boolean;
  killCount: number;
}

export interface SerializeWorldOptions {
  gamePhase?: 'INITIALIZING' | 'PLAYING' | 'MEETING' | 'GAME_OVER';
  taskProgress?: number;
  recentThoughts?: ThoughtEvent[];
  recentSpeech?: SpeechEvent[];
  llmQueueStats?: import('../types/protocol.types.ts').LLMQueueStats;
  bodies?: DeadBody[];
  recentKills?: KillEvent[];
  recentVentEvents?: VentEvent[];
  gameTimer?: import('../types/simulation.types.ts').GameTimerSnapshot;
  killStatusMap?: Map<string, KillStatusInfo>;
}

function serializeBody(body: DeadBody): BodySnapshot {
  return {
    id: body.id,
    victimId: body.victimId,
    victimName: body.victimName,
    victimColor: body.victimColor,
    position: { x: body.position.x, y: body.position.y },
    killedAt: body.killedAt,
    zone: body.zone,
    isReported: body.isReported,
  };
}

function serializeKillEvent(event: KillEvent): KillEventSnapshot {
  return {
    id: event.id,
    killerName: event.killerName,
    victimName: event.victimName,
    zone: event.zone,
    timestamp: event.timestamp,
    witnessCount: event.witnesses.length,
  };
}

function serializeVentEvent(event: VentEvent): import('../types/simulation.types.ts').VentEventSnapshot {
  return {
    id: event.id,
    playerId: event.playerId,
    playerName: event.playerName,
    ventId: event.ventId,
    ventRoom: event.ventRoom,
    eventType: event.eventType,
    relatedVentId: event.relatedVentId,
    ventPosition: event.ventPosition,
    timestamp: event.timestamp,
    witnessCount: event.witnesses.length,
  };
}

export function serializeWorld(
  agents: AIAgent[],
  tick: number,
  timestamp: number,
  options: SerializeWorldOptions = {}
): WorldSnapshot {
  return {
    tick,
    timestamp,
    gamePhase: options.gamePhase ?? 'PLAYING',
    gameTimer: options.gameTimer,
    agents: agents.map(agent => {
      const killStatus = options.killStatusMap?.get(agent.getId());
      return serializeAgent(agent, timestamp, killStatus);
    }),
    bodies: options.bodies?.map(serializeBody) ?? [],
    recentKills: options.recentKills?.map(serializeKillEvent) ?? [],
    recentVentEvents: options.recentVentEvents?.map(serializeVentEvent) ?? [],
    recentThoughts: options.recentThoughts ?? [],
    recentSpeech: options.recentSpeech ?? [],
    taskProgress: options.taskProgress ?? 0,
    llmQueueStats: options.llmQueueStats,
  };
}
