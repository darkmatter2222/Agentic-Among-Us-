/**
 * Meeting AI Manager
 * Orchestrates AI decision-making during meeting phases (discussion and voting).
 * Manages turn order, statement generation, vote collection, and response broadcasting.
 */

import type { AIAgent } from '@shared/engine/AIAgent.ts';
import type { Meeting, MeetingPhase, Statement, MeetingSnapshot } from '@shared/types/game.types.ts';
import type { AIContext } from '@shared/types/simulation.types.ts';
import {
  type MeetingContext,
  type DiscussionDecision,
  type VoteDecision,
  buildDiscussionSystemPrompt,
  buildDiscussionUserPrompt,
  buildVotingSystemPrompt,
  buildVotingUserPrompt,
  parseDiscussionResponse,
  parseVotingResponse,
  generateFallbackDiscussionStatement,
  generateFallbackVote,
} from './prompts/MeetingPrompts.js';
import type { MeetingSystem } from '@shared/engine/MeetingSystem.ts';
import { getAIDecisionService } from './AIDecisionService.js';
import { aiLogger } from '../logging/index.js';

// ========== Types ==========

export interface MeetingAIConfig {
  /** Minimum delay between agent statements (ms) */
  statementDelay: number;
  /** Maximum statements per agent per discussion */
  maxStatementsPerAgent: number;
  /** Whether reporter speaks first */
  reporterFirst: boolean;
  /** Time to wait for LLM response (ms) */
  llmTimeout: number;
}

const DEFAULT_CONFIG: MeetingAIConfig = {
  statementDelay: 2000,
  maxStatementsPerAgent: 3,
  reporterFirst: true,
  llmTimeout: 10000,
};

interface AgentMeetingState {
  statementCount: number;
  hasVoted: boolean;
  lastStatementTime: number;
}

// ========== Meeting AI Manager ==========

export class MeetingAIManager {
  private config: MeetingAIConfig;
  private meetingSystem: MeetingSystem;
  private agents: Map<string, AIAgent>;
  private agentStates: Map<string, AgentMeetingState>;
  private speakingOrder: string[];
  private currentSpeakerIndex: number;
  private isProcessing: boolean;
  private lastProcessTime: number;

  constructor(
    meetingSystem: MeetingSystem,
    agents: Map<string, AIAgent>,
    config: Partial<MeetingAIConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.meetingSystem = meetingSystem;
    this.agents = agents;
    this.agentStates = new Map();
    this.speakingOrder = [];
    this.currentSpeakerIndex = 0;
    this.isProcessing = false;
    this.lastProcessTime = 0;
  }

  // ========== Initialization ==========

  /**
   * Initialize for a new meeting
   */
  initializeMeeting(meeting: Meeting): void {
    this.agentStates.clear();
    this.speakingOrder = [];
    this.currentSpeakerIndex = 0;
    this.isProcessing = false;

    // Initialize state for each participant
    for (const participantId of meeting.participants) {
      this.agentStates.set(participantId, {
        statementCount: 0,
        hasVoted: false,
        lastStatementTime: 0,
      });
    }

    // Build speaking order (reporter first if applicable)
    this.buildSpeakingOrder(meeting);

    aiLogger.info('MeetingAIManager initialized', {
      meetingId: meeting.id,
      participants: meeting.participants.length,
      speakingOrder: this.speakingOrder.length,
    });
  }

  /**
   * Build the speaking order for discussion
   */
  private buildSpeakingOrder(meeting: Meeting): void {
    const participants = [...meeting.participants];

    if (this.config.reporterFirst && meeting.calledBy) {
      // Move reporter to front
      const reporterIndex = participants.indexOf(meeting.calledBy);
      if (reporterIndex > 0) {
        participants.splice(reporterIndex, 1);
        participants.unshift(meeting.calledBy);
      }
    } else {
      // Shuffle for random order
      for (let i = participants.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [participants[i], participants[j]] = [participants[j], participants[i]];
      }
    }

    this.speakingOrder = participants;
  }

  // ========== Update Loop ==========

  /**
   * Update the meeting AI - call from game tick during DISCUSSION or VOTING phase
   * Returns statements/votes generated this tick
   */
  async update(
    meeting: Meeting,
    timestamp: number,
    getAgentContext: (agentId: string) => AIContext | null
  ): Promise<{
    statements: Array<{ agentId: string; decision: DiscussionDecision }>;
    votes: Array<{ agentId: string; decision: VoteDecision }>;
  }> {
    const results = {
      statements: [] as Array<{ agentId: string; decision: DiscussionDecision }>,
      votes: [] as Array<{ agentId: string; decision: VoteDecision }>,
    };

    // Don't process if already processing or too soon
    if (this.isProcessing) return results;
    if (timestamp - this.lastProcessTime < this.config.statementDelay) return results;

    this.isProcessing = true;
    this.lastProcessTime = timestamp;

    try {
      if (meeting.phase === 'DISCUSSION') {
        const statement = await this.processDiscussionTurn(meeting, timestamp, getAgentContext);
        if (statement) {
          results.statements.push(statement);
        }
      } else if (meeting.phase === 'VOTING') {
        const votes = await this.processVotingPhase(meeting, timestamp, getAgentContext);
        results.votes.push(...votes);
      }
    } finally {
      this.isProcessing = false;
    }

    return results;
  }

  // ========== Discussion Phase ==========

  /**
   * Process a single discussion turn
   */
  private async processDiscussionTurn(
    meeting: Meeting,
    timestamp: number,
    getAgentContext: (agentId: string) => AIContext | null
  ): Promise<{ agentId: string; decision: DiscussionDecision } | null> {
    // Find next agent who can speak
    const agentId = this.getNextSpeaker(meeting);
    if (!agentId) {
      // All agents have spoken enough, wait for phase to end
      return null;
    }

    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const baseContext = getAgentContext(agentId);
    if (!baseContext) return null;

    // Build meeting context
    const meetingContext = this.buildMeetingContext(baseContext, meeting, timestamp);

    // Get statement from LLM
    const decision = await this.getDiscussionDecision(meetingContext);

    // Update agent state
    const state = this.agentStates.get(agentId);
    if (state) {
      state.statementCount++;
      state.lastStatementTime = timestamp;
    }

    // Move to next speaker
    this.currentSpeakerIndex = (this.currentSpeakerIndex + 1) % this.speakingOrder.length;

    return { agentId, decision };
  }

  /**
   * Get the next agent who should speak
   */
  private getNextSpeaker(meeting: Meeting): string | null {
    const maxChecks = this.speakingOrder.length;
    
    for (let i = 0; i < maxChecks; i++) {
      const index = (this.currentSpeakerIndex + i) % this.speakingOrder.length;
      const agentId = this.speakingOrder[index];
      
      // Check if agent can still speak
      const state = this.agentStates.get(agentId);
      if (state && state.statementCount < this.config.maxStatementsPerAgent) {
        // Check if agent is still a participant
        if (meeting.participants.includes(agentId)) {
          this.currentSpeakerIndex = index;
          return agentId;
        }
      }
    }

    return null;
  }

  /**
   * Get a discussion decision from the LLM
   */
  private async getDiscussionDecision(context: MeetingContext): Promise<DiscussionDecision> {
    try {
      const systemPrompt = buildDiscussionSystemPrompt(context);
      const userPrompt = buildDiscussionUserPrompt(context);

      const aiService = getAIDecisionService();
      const response = await aiService.getRawDecision(systemPrompt, userPrompt, {
        maxTokens: 200,
        temperature: 0.7,
      });

      if (!response) {
        aiLogger.warn('LLM discussion request failed', { agentId: context.agentId });
        return generateFallbackDiscussionStatement(context);
      }

      const parsed = parseDiscussionResponse(response);
      if (!parsed) {
        aiLogger.warn('Failed to parse discussion response', { agentId: context.agentId, response });
        return generateFallbackDiscussionStatement(context);
      }

      return parsed;
    } catch (error) {
      aiLogger.error('Error getting discussion decision', { error, agentId: context.agentId });
      return generateFallbackDiscussionStatement(context);
    }
  }

  // ========== Voting Phase ==========

  /**
   * Process voting phase - get votes from all agents who haven't voted
   */
  private async processVotingPhase(
    meeting: Meeting,
    timestamp: number,
    getAgentContext: (agentId: string) => AIContext | null
  ): Promise<Array<{ agentId: string; decision: VoteDecision }>> {
    const votes: Array<{ agentId: string; decision: VoteDecision }> = [];

    // Get all agents who haven't voted yet
    const pendingVoters: string[] = [];
    for (const participantId of meeting.participants) {
      const state = this.agentStates.get(participantId);
      if (state && !state.hasVoted) {
        pendingVoters.push(participantId);
      }
    }

    if (pendingVoters.length === 0) return votes;

    // Process votes in parallel (up to 3 at a time)
    const batchSize = 3;
    for (let i = 0; i < pendingVoters.length; i += batchSize) {
      const batch = pendingVoters.slice(i, i + batchSize);
      const batchPromises = batch.map(async (agentId) => {
        const agent = this.agents.get(agentId);
        if (!agent) return null;

        const baseContext = getAgentContext(agentId);
        if (!baseContext) return null;

        const meetingContext = this.buildMeetingContext(baseContext, meeting, timestamp);
        const decision = await this.getVoteDecision(meetingContext);

        // Mark as voted
        const state = this.agentStates.get(agentId);
        if (state) {
          state.hasVoted = true;
        }

        return { agentId, decision };
      });

      const batchResults = await Promise.all(batchPromises);
      for (const result of batchResults) {
        if (result) {
          votes.push(result);
        }
      }
    }

    return votes;
  }

  /**
   * Get a vote decision from the LLM
   */
  private async getVoteDecision(context: MeetingContext): Promise<VoteDecision> {
    try {
      const systemPrompt = buildVotingSystemPrompt(context);
      const userPrompt = buildVotingUserPrompt(context);

      const aiService = getAIDecisionService();
      const response = await aiService.getRawDecision(systemPrompt, userPrompt, {
        maxTokens: 150,
        temperature: 0.5,
      });

      if (!response) {
        aiLogger.warn('LLM vote request failed', { agentId: context.agentId });
        return generateFallbackVote(context);
      }

      const validTargets = context.meeting.participants
        .filter(p => p.id !== context.agentId)
        .map(p => p.id);

      const parsed = parseVotingResponse(response, validTargets);
      if (!parsed) {
        aiLogger.warn('Failed to parse voting response', { agentId: context.agentId, response });
        return generateFallbackVote(context);
      }

      return parsed;
    } catch (error) {
      aiLogger.error('Error getting vote decision', { error, agentId: context.agentId });
      return generateFallbackVote(context);
    }
  }  // ========== Context Building ==========

  /**
   * Build a MeetingContext from a base AIContext
   */
  private buildMeetingContext(
    baseContext: AIContext,
    meeting: Meeting,
    timestamp: number
  ): MeetingContext {
    // Convert meeting to snapshot format
    const meetingSnapshot = this.createMeetingSnapshot(meeting);
    
    // Convert statements to snapshot format
    const statements: import('@shared/types/game.types.ts').StatementSnapshot[] = meeting.statements.map(s => ({
      id: s.id,
      playerId: s.playerId,
      playerName: this.getAgentName(s.playerId),
      playerColor: this.getAgentColor(s.playerId),
      content: s.content,
      timestamp: s.timestamp,
      accusesPlayer: s.accusesPlayer,
      defendsPlayer: s.defendsPlayer,
    }));

    // Get voted players
    const votedPlayers = meeting.votes.map(v => v.voterId);

    // Calculate time remaining
    const timeRemaining = Math.max(0, Math.floor((meeting.phaseEndTime - timestamp) / 1000));

    // Get witness info if available from the base context
    const witnessMemory = baseContext.witnessMemory;
    const meetingWitnessInfo = witnessMemory?.sawKill ? {
      sawKill: witnessMemory.sawKill,
      killerColor: witnessMemory.suspectedKillerColor,
      colorConfidence: witnessMemory.colorConfidence,
      bodyLocation: meeting.bodyZone,
      bodyVictim: meeting.bodyVictimName,
    } : undefined;

    return {
      ...baseContext,
      meeting: meetingSnapshot,
      statements,
      votedPlayers,
      timeRemaining,
      meetingWitnessInfo,
    };
  }

  /**
   * Create a meeting snapshot for context
   */
  private createMeetingSnapshot(meeting: Meeting): MeetingSnapshot {
    const now = Date.now();

    // Build body report info if this is a body report meeting
    const bodyReport = meeting.type === 'BODY_REPORT' && meeting.bodyVictimId ? {
      victimId: meeting.bodyVictimId,
      victimName: meeting.bodyVictimName || 'Unknown',
      victimColor: meeting.bodyVictimColor ?? 0,
      location: meeting.bodyZone || 'Unknown',
    } : undefined;

    return {
      id: meeting.id,
      type: meeting.type,
      phase: meeting.phase,
      calledById: meeting.calledBy,
      calledByName: meeting.calledByName,
      calledByColor: this.getAgentColor(meeting.calledBy),
      bodyReport,
      discussionEndTime: meeting.discussionEndTime,
      votingEndTime: meeting.votingEndTime,
      phaseEndTime: meeting.phaseEndTime,
      timeRemaining: Math.max(0, Math.floor((meeting.phaseEndTime - now) / 1000)),
      participants: meeting.participants.map(id => ({
        id,
        name: this.getAgentName(id),
        color: this.getAgentColor(id),
        isAlive: true,
        isGhost: false,
        hasVoted: meeting.votes.some(v => v.voterId === id),
      })),
      votedPlayerIds: meeting.votes.map(v => v.voterId),
      statements: meeting.statements.map(s => ({
        id: s.id,
        playerId: s.playerId,
        playerName: this.getAgentName(s.playerId),
        playerColor: this.getAgentColor(s.playerId),
        content: s.content,
        timestamp: s.timestamp,
        accusesPlayer: s.accusesPlayer,
        defendsPlayer: s.defendsPlayer,
      })),
    };
  }

  /**
   * Get agent name from ID
   */
  private getAgentName(agentId: string): string {
    const agent = this.agents.get(agentId);
    return agent?.getName() || 'Unknown';
  }

  /**
   * Get agent color from ID
   */
  private getAgentColor(agentId: string): number {
    const agent = this.agents.get(agentId);
    return agent?.getColor() || 0;
  }

  // ========== Getters ==========

  /**
   * Check if all agents have made their maximum statements
   */
  allAgentsSpoken(): boolean {
    for (const [agentId, state] of this.agentStates) {
      if (state.statementCount < this.config.maxStatementsPerAgent) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if all agents have voted
   */
  allAgentsVoted(): boolean {
    for (const [agentId, state] of this.agentStates) {
      if (!state.hasVoted) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get current speaker
   */
  getCurrentSpeaker(): string | null {
    if (this.speakingOrder.length === 0) return null;
    return this.speakingOrder[this.currentSpeakerIndex];
  }
}
