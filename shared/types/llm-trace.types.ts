/**
 * LLM Trace Types
 * Captures full LLM request/response data for debugging and inspection
 */

import type { Point } from '../data/poly3-map.ts';
import type { AIGoalType, TaskAssignment } from './simulation.types.ts';

// Agent position snapshot at the time of LLM request
export interface AgentPositionSnapshot {
  id: string;
  name: string;
  color: number;
  position: Point;
  zone: string | null;
  activityState: string;
  currentGoal: string | null;
  role?: 'CREWMATE' | 'IMPOSTOR';  // Agent role
  state?: 'ALIVE' | 'DEAD';        // Player state
}

// Full LLM trace event
export interface LLMTraceEvent {
  id: string;
  timestamp: number;
  
  // Agent who made the request
  agentId: string;
  agentName: string;
  agentColor: number;
  agentRole: 'CREWMATE' | 'IMPOSTOR';
  
  // Request type
  requestType: 'decision' | 'thought' | 'speech' | 'conversation';
  
  // Input data
  systemPrompt: string;
  userPrompt: string;
  
  // Output data
  rawResponse: string;
  
  // Parsed result (if decision)
  parsedDecision?: {
    goalType: AIGoalType;
    targetAgentId?: string;
    targetTaskIndex?: number;
    reasoning: string;
    thought?: string;
    speech?: string;
  };
  
  // Context at time of request
  context: {
    zone: string | null;
    visibleAgents: Array<{ id: string; name: string; distance: number }>;
    assignedTasks: Array<{ taskType: string; room: string; isCompleted: boolean }>;
    taskProgress: { completed: number; total: number };
  };
  
  // World state at time of request
  agentPositions: AgentPositionSnapshot[];
  
  // Performance metrics
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  
  // Success/failure
  success: boolean;
  error?: string;
}

// Lightweight version for timeline display (without full prompts)
export interface LLMTraceEventSummary {
  id: string;
  timestamp: number;
  agentId: string;
  agentName: string;
  agentColor: number;
  agentRole: 'CREWMATE' | 'IMPOSTOR';
  requestType: 'decision' | 'thought' | 'speech' | 'conversation';
  zone: string | null;
  
  // Brief summary of result
  resultSummary: string; // e.g., "GOAL: KILL, TARGET: Yellow" or "Thought: I should be careful..."
  
  // For decisions
  goalType?: AIGoalType;
  targetName?: string;
  
  // Performance
  durationMs: number;
  success: boolean;
}

// Message for broadcasting trace events
export interface LLMTraceMessage {
  type: 'llm-trace';
  payload: LLMTraceEvent;
}
