import type { AgentSnapshot, AgentSummarySnapshot, WorldSnapshot } from './simulation.types.ts';

export const PROTOCOL_VERSION = '0.1.0';

// Capacity configuration for the LLM
export interface LLMCapacityConfig {
  maxTokensPerSecond: number;  // Ceiling (e.g., 500 tokens/sec)
  minThinkingCoefficient: number;  // Minimum thinking rate (0.1 = 10%)
  maxThinkingCoefficient: number;  // Maximum thinking rate (1.0 = 100%)
  targetUtilization: number;  // Target capacity utilization (e.g., 0.8 = 80%)
}

// LLM Queue Statistics for monitoring
export interface LLMQueueStats {
  // Queue state
  queueDepth: number;
  processingCount: number;
  
  // Totals
  totalProcessed: number;
  totalTimedOut: number;
  totalFailed: number;
  
  // Performance metrics (calculated per selected interval)
  avgProcessingTimeMs: number;
  processedPerSecond: number;
  
  // Token throughput
  tokensPerSecondIn: number;   // Prompt tokens per second
  tokensPerSecondOut: number;  // Completion tokens per second
  tokensPerSecondTotal: number; // Combined throughput
  tokensPerMinuteIn: number;
  tokensPerMinuteOut: number;
  tokensPerMinuteTotal: number;
  
  // Average tokens per request
  avgTokensIn: number;
  avgTokensOut: number;
  
  // Lifetime token counts
  totalPromptTokens: number;
  totalCompletionTokens: number;
  
  // Capacity metrics
  capacityConfig: LLMCapacityConfig;
  capacityUtilization: number;  // 0-1, current usage vs max capacity
  thinkingCoefficient: number;  // 0-1, how much agents should think (higher = more thinking)
  availableCapacity: number;    // tokens/sec still available
  
  // Recent request history
  recentRequests: Array<{
    timestamp: number;
    durationMs: number;
    success: boolean;
    timedOut: boolean;
    promptTokens?: number;
    completionTokens?: number;
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

export interface LLMTraceMessage {
  type: 'llm-trace';
  payload: import('./llm-trace.types.ts').LLMTraceEvent;
}

export type ServerMessage =
  | ({ type: 'handshake'; payload: HandshakePayload })
  | SnapshotMessage
  | StateDeltaMessage
  | HeartbeatMessage
  | ErrorMessage
  | LLMTraceMessage;

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
  role?: 'CREWMATE' | 'IMPOSTOR';
  playerState?: 'ALIVE' | 'DEAD' | 'GHOST';
}

export interface HeartbeatPayload {
  serverTime: number;
  tick: number;
}
