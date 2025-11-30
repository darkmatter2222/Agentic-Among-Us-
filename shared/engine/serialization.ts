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
  HeardSpeechEvent,
  BodySnapshot,
  KillEventSnapshot,
  GamePhase,
  BodyReportEvent,
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
    personalityId: agent.getPersonalityId() ?? undefined,
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
    // Recently heard with direct-address detection
    recentlyHeard: recentConversations.map(conv => ({
      ...conv,
      wasDirectlyAddressed: agent.getName ? 
        conv.message.toLowerCase().includes(agent.getName().toLowerCase()) : false,
    })),
    isBeingFollowed: typeof agent.isBeingFollowed === 'function' ? agent.isBeingFollowed() : false,
    buddyId: agent.getBuddyId ? agent.getBuddyId() : null,

    // Kill status (impostors only)
    killStatus: killStatus,

    // God Mode status
    godMode: agent.getGodModeState ? agent.getGodModeState() : undefined,

    // Full memory for detailed UI display
    fullMemory: agent.getFullMemory ? (() => {
      const mem = agent.getFullMemory();
      return {
        observations: mem.observations.map(o => ({
          id: o.id,
          timestamp: o.timestamp,
          type: o.type,
          subjectName: o.subjectName,
          zone: o.zone,
          description: o.description,
        })),
        conversations: mem.conversations.map(c => ({
          id: c.id,
          timestamp: c.timestamp,
          speakerName: c.speakerName,
          message: c.message,
          zone: c.zone,
        })),
        accusations: mem.accusations.map(a => ({
          id: a.id,
          timestamp: a.timestamp,
          accuserName: a.accuserName,
          accusedName: a.accusedName,
          reason: a.reason,
        })),
        alibis: mem.alibis.map(a => ({
          id: a.id,
          timestamp: a.timestamp,
          agentName: a.agentName,
          claimedZone: a.claimedZone,
          claimedActivity: a.claimedActivity,
        })),
        suspicionRecords: mem.suspicionRecords.map(s => ({
          agentId: s.agentId,
          agentName: s.agentName,
          level: s.level,
          reasons: s.reasons.map(r => ({ reason: r.reason, delta: r.delta, category: r.category })),
        })),
      };
    })() : undefined,
  };
}export function serializeAgentSummary(agent: AIAgent): AgentSummarySnapshot {
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
  gamePhase?: GamePhase;
  /** True if at least one body has been discovered */
  firstBodyDiscovered?: boolean;
  /** Most recent body report event for UI animation */
  recentBodyReport?: BodyReportEvent;
  taskProgress?: number;
  recentThoughts?: ThoughtEvent[];
  recentSpeech?: SpeechEvent[];
  recentHeard?: HeardSpeechEvent[];
  llmQueueStats?: import('../types/protocol.types.ts').LLMQueueStats;
  bodies?: DeadBody[];
  recentKills?: KillEvent[];
  recentVentEvents?: VentEvent[];
  gameTimer?: import('../types/simulation.types.ts').GameTimerSnapshot;
  killStatusMap?: Map<string, KillStatusInfo>;
  sabotageState?: import('../types/simulation.types.ts').SabotageSnapshot;
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
    gamePhase: options.gamePhase ?? 'WORKING',
    gameTimer: options.gameTimer,
    firstBodyDiscovered: options.firstBodyDiscovered ?? false,
    recentBodyReport: options.recentBodyReport,
    agents: agents.map(agent => {
      const killStatus = options.killStatusMap?.get(agent.getId());
      return serializeAgent(agent, timestamp, killStatus);
    }),
    bodies: options.bodies?.map(serializeBody) ?? [],
    recentKills: options.recentKills?.map(serializeKillEvent) ?? [],
    recentVentEvents: options.recentVentEvents?.map(serializeVentEvent) ?? [],
    recentThoughts: options.recentThoughts ?? [],
    recentSpeech: options.recentSpeech ?? [],
    recentHeard: options.recentHeard ?? [],
    taskProgress: options.taskProgress ?? 0,
    llmQueueStats: options.llmQueueStats,
    sabotageState: options.sabotageState,
  };
}
