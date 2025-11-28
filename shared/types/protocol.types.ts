import type { AgentSnapshot, AgentSummarySnapshot, WorldSnapshot } from './simulation.types.ts';

export const PROTOCOL_VERSION = '0.1.0';

// LLM Queue Statistics for monitoring
export interface LLMQueueStats {
  queueDepth: number;
  processingCount: number;
  totalProcessed: number;
  totalTimedOut: number;
  totalFailed: number;
  avgProcessingTimeMs1Min: number;
  avgProcessingTimeMs5Min: number;
  processedPerSecond1Min: number;
  processedPerSecond5Min: number;
  recentRequests: Array<{
    timestamp: number;
    durationMs: number;
    success: boolean;
    timedOut: boolean;
  }>;
}

export interface HandshakePayload {
  protocolVersion: string;
  serverTime: number;
}

export interface SnapshotMessage {
  type: 'snapshot';
  payload: WorldSnapshot;
}

export interface StateDeltaMessage {
  type: 'state-update';
  payload: WorldDelta;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  payload: HeartbeatPayload;
}

export interface ErrorMessage {
  type: 'error';
  payload: {
    code: string;
    message: string;
  };
}

export type ServerMessage =
  | ({ type: 'handshake'; payload: HandshakePayload })
  | SnapshotMessage
  | StateDeltaMessage
  | HeartbeatMessage
  | ErrorMessage;

export interface WorldDelta {
  tick: number;
  timestamp: number;
  agents: AgentDelta[];
  removedAgents: string[];
  // World-level state that changes
  taskProgress?: number;
  gamePhase?: 'INITIALIZING' | 'PLAYING' | 'MEETING' | 'GAME_OVER';
  recentThoughts?: import('./simulation.types.ts').ThoughtEvent[];
  recentSpeech?: import('./simulation.types.ts').SpeechEvent[];
  // LLM Queue stats for monitoring
  llmQueueStats?: LLMQueueStats;
}

export interface AgentDelta {
  id: string;
  summaryChanged: boolean;
  summary?: AgentSummarySnapshot;
  movementChanged: boolean;
  movement?: AgentSnapshot['movement'];
  aiStateChanged?: boolean;
  aiState?: AgentAIStateDelta;
}

export interface AgentAIStateDelta {
  isThinking?: boolean;
  currentThought?: string | null;
  recentSpeech?: string | null;
  visibleAgentIds?: string[];
  assignedTasks?: AgentSnapshot['assignedTasks'];
  currentTaskIndex?: number | null;
  tasksCompleted?: number;
}

export interface HeartbeatPayload {
  serverTime: number;
  tick: number;
}
