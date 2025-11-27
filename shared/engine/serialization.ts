import type { AIAgent } from './AIAgent.ts';
import type { MovementState } from './MovementController.ts';
import type { PlayerStateMachineState } from './PlayerStateMachine.ts';
import type {
  AgentSnapshot,
  AgentSummarySnapshot,
  MovementSnapshot,
  WorldSnapshot,
  ThoughtEvent,
  SpeechEvent,
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

export function serializeAgent(agent: AIAgent, timestamp: number): AgentSnapshot {
  const movementState = agent.getMovementController().getState();
  const playerState = agent.getStateMachine().getState();

  const summary = serializeStateMachineState(playerState, timestamp);
  const movement = serializeMovementState(movementState);

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
    playerState: agent.getPlayerState(),
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
    suspicionLevels: agent.getSuspicionLevels(),
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

export interface SerializeWorldOptions {
  gamePhase?: 'INITIALIZING' | 'PLAYING' | 'MEETING' | 'GAME_OVER';
  taskProgress?: number;
  recentThoughts?: ThoughtEvent[];
  recentSpeech?: SpeechEvent[];
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
    agents: agents.map(agent => serializeAgent(agent, timestamp)),
    recentThoughts: options.recentThoughts ?? [],
    recentSpeech: options.recentSpeech ?? [],
    taskProgress: options.taskProgress ?? 0,
  };
}
