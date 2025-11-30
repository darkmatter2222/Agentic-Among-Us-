/**
 * AI Decision Service
 * Orchestrates LLM inference for agent decision-making with trigger-based activation
 * Uses LLMQueue to serialize requests and prevent GPU overload
 */

import type { Point } from '@shared/data/poly3-map.ts';
import type { PlayerRole } from '@shared/types/game.types.ts';
import type {
  AIContext,
  AIDecision,
  TaskAssignment,
  ThoughtEvent,
  SpeechEvent,
  ThoughtTrigger
} from '@shared/types/simulation.types.ts';
import type { LLMTraceEvent, AgentPositionSnapshot } from '@shared/types/llm-trace.types.ts';
import { COLOR_NAMES } from '@shared/constants/colors.ts';
import { getPersonalityById } from '@shared/data/personalities.ts';
import {
  buildCrewmatePrompt,
  buildImpostorPrompt,
  buildThoughtPrompt,
  buildSpeechPrompt,
  parseAIResponse
} from './prompts/AgentPrompts.js';
import { getLLMQueue, type LLMQueueStats } from './LLMQueue.js';
import { aiLogger, speechLogger, thoughtLogger } from '../logging/index.js';

// ========== Speech Validation Helpers ==========

/**
 * Check if speech mentions agents who aren't nearby
 * Returns list of mentioned names that aren't in the nearby list
 */
function findInvalidMentions(message: string, speakerName: string, nearbyNames: string[]): string[] {
  const invalidMentions: string[] = [];
  const lowerNearby = nearbyNames.map(n => n.toLowerCase());
  const lowerSpeaker = speakerName.toLowerCase();
  
  for (const colorName of COLOR_NAMES) {
    const lowerColor = colorName.toLowerCase();
    // Skip if it's the speaker's name
    if (lowerColor === lowerSpeaker) continue;
    // Skip if they're nearby
    if (lowerNearby.includes(lowerColor)) continue;
    
    // Check if the color is mentioned in the message
    const regex = new RegExp(`\\b${colorName}\\b`, 'i');
    if (regex.test(message)) {
      invalidMentions.push(colorName);
    }
  }
  
  return invalidMentions;
}

/**
 * Clean self-references from speech (e.g., "Orange is" when Orange is speaking)
 */
function cleanSelfReferences(message: string, speakerName: string): string {
  // Replace "Name is/was/did..." with "I am/was/did..."
  message = message.replace(new RegExp(`\\b${speakerName}\\s+is\\b`, 'gi'), 'I am');
  message = message.replace(new RegExp(`\\b${speakerName}\\s+was\\b`, 'gi'), 'I was');
  message = message.replace(new RegExp(`\\b${speakerName}\\s+did\\b`, 'gi'), 'I did');
  message = message.replace(new RegExp(`\\b${speakerName}\\s+has\\b`, 'gi'), 'I have');
  message = message.replace(new RegExp(`\\b${speakerName}\\s+had\\b`, 'gi'), 'I had');
  message = message.replace(new RegExp(`\\b${speakerName}\\s+looks\\b`, 'gi'), 'I look');
  message = message.replace(new RegExp(`\\b${speakerName}\\s+seems\\b`, 'gi'), 'I seem');
  return message;
}// ========== AI Model Client (inline for server-side) ==========

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AIModelOptions {
  temperature?: number;
  maxTokens?: number;
}

class AIModelClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://192.168.86.48:8080') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Make a raw LLM request (without queue - used internally by queued methods)
   */
  private async makeRequest(systemPrompt: string, userPrompt: string, options?: AIModelOptions): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const payload = {
      messages,
      temperature: options?.temperature ?? 0.8,
      max_tokens: options?.maxTokens ?? 200,
      stream: false
    };

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status}`);
    }

    const result = await response.json() as { 
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    
    // Record token usage for metrics
    const queue = getLLMQueue(10000);
    if (result.usage) {
      queue.recordTokenUsage(
        result.usage.prompt_tokens || 0,
        result.usage.completion_tokens || 0
      );
    }
    
    return result.choices?.[0]?.message?.content || '';
  }

  /**
   * Get a decision through the LLM queue (serialized, with timeout)
   */
  async getDecision(systemPrompt: string, userPrompt: string, options?: AIModelOptions): Promise<string> {
    const queue = getLLMQueue(10000); // 10 second timeout for LLM requests
    return queue.enqueue(() => this.makeRequest(systemPrompt, userPrompt, options));
  }
}

// ========== Trigger Configuration ==========

interface TriggerConfig {
  baseThoughtCooldownMs: number;      // Base time between thoughts per agent
  baseSpeechCooldownMs: number;       // Base time between speech per agent
  baseRandomThoughtIntervalMs: [number, number]; // [min, max] for random thoughts
  speechRange: number;            // Units within which speech is heard
  closePassDistance: number;      // Distance to trigger "passed agent closely"
}

const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  baseThoughtCooldownMs: 6000,        // 6 seconds base between thoughts (faster thinking)
  baseSpeechCooldownMs: 12000,        // 12 seconds base between speech (much more chatty!)
  baseRandomThoughtIntervalMs: [8000, 30000], // Random thought every 8-30 seconds base (more frequent)
  speechRange: 150,               // 150 units hearing range
  closePassDistance: 50           // 50 units = close pass
};

// ========== Agent State Tracking ==========

interface AgentAIState {
  lastThoughtTime: number;
  lastSpeechTime: number;
  nextRandomThoughtTime: number;
  previouslyVisibleAgents: Set<string>;
  previouslyInKillRange: Set<string>;  // Track agents who were in kill range last tick
  previouslyVisibleBodies: Set<string>; // Track body IDs we've already seen (for first-sighting trigger)
  lastZone: string | null;
  recentEvents: string[];
  conversationHistory: ChatMessage[];
}

// ========== Active Conversation Tracking ==========

interface ActiveConversation {
  id: string;
  participants: string[]; // Agent names (colors)
  participantIds: string[]; // Agent IDs
  startTime: number;
  lastActivityTime: number;
  turns: ConversationTurn[];
  maxTurns: number; // Random 2-10 turns
  topic?: 'suspicion' | 'alibi' | 'task_info' | 'small_talk' | 'accusation' | 'defense';
  isActive: boolean;
}

interface ConversationTurn {
  speakerName: string;
  speakerId: string;
  message: string;
  timestamp: number;
}

// ========== Main Service ==========

export class AIDecisionService {
  private aiClient: AIModelClient;
  private config: TriggerConfig;
  private agentStates: Map<string, AgentAIState>;
  private pendingThoughts: ThoughtEvent[];
  private pendingSpeech: SpeechEvent[];
  private thoughtIdCounter: number;
  private speechIdCounter: number;
  private traceIdCounter: number;
  
  // LLM trace event listeners
  private traceListeners: Set<(trace: LLMTraceEvent) => void>;
  
  // Current agent positions (updated externally for trace capture)
  private currentAgentPositions: AgentPositionSnapshot[] = [];
  
  // Active conversations between agents
  private activeConversations: Map<string, ActiveConversation>;
  private conversationIdCounter: number;

  constructor(aiServerUrl?: string, config?: Partial<TriggerConfig>) {
    this.aiClient = new AIModelClient(aiServerUrl);
    this.config = { ...DEFAULT_TRIGGER_CONFIG, ...config };
    this.agentStates = new Map();
    this.pendingThoughts = [];
    this.pendingSpeech = [];
    this.thoughtIdCounter = 0;
    this.speechIdCounter = 0;
    this.traceIdCounter = 0;
    this.traceListeners = new Set();
    this.activeConversations = new Map();
    this.conversationIdCounter = 0;
  }

  /**
   * Get LLM queue statistics for monitoring
   */
  getQueueStats(): LLMQueueStats {
    return getLLMQueue(10000).getStats();
  }

  /**
   * Get current thinking coefficient from the queue
   */
  getThinkingCoefficient(): number {
    return getLLMQueue(10000).calculateThinkingCoefficient();
  }

  /**
   * Get effective cooldowns based on current capacity
   * Higher thinking coefficient = shorter cooldowns = more thinking
   */
  private getEffectiveCooldowns(): { thoughtCooldown: number; speechCooldown: number; randomInterval: [number, number] } {
    const coefficient = this.getThinkingCoefficient();
    
    // Invert coefficient for cooldowns (higher coefficient = shorter cooldown)
    const cooldownMultiplier = 1 / coefficient;
    
    return {
      thoughtCooldown: Math.round(this.config.baseThoughtCooldownMs * cooldownMultiplier),
      speechCooldown: Math.round(this.config.baseSpeechCooldownMs * cooldownMultiplier),
      randomInterval: [
        Math.round(this.config.baseRandomThoughtIntervalMs[0] * cooldownMultiplier),
        Math.round(this.config.baseRandomThoughtIntervalMs[1] * cooldownMultiplier),
      ] as [number, number],
    };
  }

  /**
   * Initialize state tracking for an agent
   * Each agent gets a randomized starting offset to avoid synchronized thinking
   */
  // ========== LLM Trace Event System ==========
  
  /**
   * Register a listener for LLM trace events
   */
  onLLMTrace(listener: (trace: LLMTraceEvent) => void): () => void {
    this.traceListeners.add(listener);
    return () => {
      this.traceListeners.delete(listener);
    };
  }
  
  /**
   * Update current agent positions (called by simulation each tick for trace capture)
   */
  updateAgentPositions(positions: AgentPositionSnapshot[]): void {
    this.currentAgentPositions = positions;
  }
  
  /**
   * Emit a trace event to all listeners
   */
  private emitTraceEvent(trace: LLMTraceEvent): void {
    for (const listener of this.traceListeners) {
      try {
        listener(trace);
      } catch (error) {
        aiLogger.error('Error in trace listener', { error: error as Error });
      }
    }
  }
  
  /**
   * Generate unique trace ID
   */
  private generateTraceId(): string {
    return `trace-${++this.traceIdCounter}-${Date.now()}`;
  }

  /**
   * Get agent color from current positions snapshot
   */
  private getAgentColor(agentId: string): number {
    const agent = this.currentAgentPositions.find(a => a.id === agentId);
    return agent?.color ?? 0;
  }

  initializeAgent(agentId: string): void {
    const now = Date.now();
    // Randomize initial state to desynchronize agents
    const randomOffset = Math.random() * 15000; // 0-15 second random offset
    const randomThoughtDelay = Math.random() * 10000; // 0-10 second random initial delay
    this.agentStates.set(agentId, {
      lastThoughtTime: now - this.config.baseThoughtCooldownMs + randomOffset, // Stagger initial cooldowns
      lastSpeechTime: now - this.config.baseSpeechCooldownMs + (Math.random() * 20000), // Randomize speech timing
      nextRandomThoughtTime: now + this.randomInterval() + randomThoughtDelay, // Add random delay to first thought
      previouslyVisibleAgents: new Set(),
      previouslyInKillRange: new Set(),
      previouslyVisibleBodies: new Set(),
      lastZone: null,
      recentEvents: [],
      conversationHistory: []
    });
  }

  /**
   * Process triggers and potentially generate thoughts/speech for an agent
   */
  async processAgentTriggers(context: AIContext): Promise<{
    decision?: AIDecision;
    thought?: ThoughtEvent;
    speech?: SpeechEvent;
  }> {
    const state = this.agentStates.get(context.agentId);
    if (!state) {
      this.initializeAgent(context.agentId);
      return {};
    }

    const now = Date.now();

    // Check if there's a pending conversation reply (now properly typed in AIContext)
    const pendingReply = context.pendingReply;

    // Get dynamic cooldowns based on current LLM capacity
    const cooldowns = this.getEffectiveCooldowns();
    const canSpeak = now - state.lastSpeechTime >= cooldowns.speechCooldown;

    // Handle conversation replies with priority - OBSERVATION → THOUGHT → DECISION → ACTION
    if (pendingReply && canSpeak) {
      speechLogger.debug('Processing reply', { agentName: context.agentName, from: pendingReply.speakerName, messagePreview: pendingReply.message.substring(0, 40) });
      
      // STEP 1: Generate a THOUGHT about what we just heard (observation processing)
      // Pass the pending reply info so the thought can be about the conversation
      const thoughtContext = {
        ...context,
        // Enhance context with pending reply details for better thought generation
        heardSpeechFrom: pendingReply.speakerName,
        heardSpeechMessage: pendingReply.message,
      };

      thoughtLogger.debug('Generating thought about heard speech', { agentName: context.agentName, step: 1 });
      const thought = await this.generateThought(thoughtContext as AIContext, 'heard_speech', now);
      if (thought) {
        state.lastThoughtTime = now;
        thoughtLogger.debug('Thought generated', { agentName: context.agentName, thoughtPreview: thought.thought.substring(0, 50) });
      }

      // STEP 2: Check if we're in a conversation with this speaker
      let conversation = this.getActiveConversationForAgent(context.agentId);

      if (!conversation) {
        // Start a new conversation
        speechLogger.debug('Starting new conversation', { agentName: context.agentName, targetName: pendingReply.speakerName, step: 2 });
        const convId = this.startConversation(
          pendingReply.speakerId,
          pendingReply.speakerName,
          context.agentName,
          context.agentId,
          pendingReply.message
        );
        conversation = this.activeConversations.get(convId) || null;
      } else {
        // Add their message to existing conversation
        speechLogger.debug('Adding to existing conversation', { agentName: context.agentName, conversationId: conversation.id, step: 2 });
        this.addConversationReply(conversation.id, pendingReply.speakerId, pendingReply.speakerName, pendingReply.message);
      }

      if (conversation && conversation.isActive) {
        // STEP 3: Generate our spoken reply based on the thought we had
        speechLogger.debug('Generating speech reply', { agentName: context.agentName, step: 3 });
        const speech = await this.generateConversationReply(context, conversation, now);
        if (speech) {
          state.lastSpeechTime = now;
          speechLogger.info('Agent spoke', { agentName: context.agentName, messagePreview: speech.message.substring(0, 50) });
          // Return both thought and speech - thought happened first, speech is the action
          return { thought, speech };
        }
        speechLogger.debug('No speech generated', { agentName: context.agentName });
        // Even if we don't speak, we still thought about it
        return { thought };
      }
      speechLogger.debug('Conversation not active', { agentName: context.agentName });
      // Conversation not active, but we still processed the observation with a thought
      return { thought };
    } else if (pendingReply && !canSpeak) {
      speechLogger.debug('Has pending reply but on cooldown', { agentName: context.agentName });
    }// Normal trigger processing
    const triggers = this.detectTriggers(context, state, now);

    // No triggers? No AI call needed
    if (triggers.length === 0) {
      return {};
    }

    // Pick highest priority trigger FIRST (before cooldown check)
    const trigger = triggers[0];

    // ===== Body discovered - trigger immediate LLM decision (bypass cooldown) =====
    // Seeing a body is critical - the agent must decide what to do NOW
    // Crewmates usually report, but might be scared or confused
    // Impostors might self-report, flee, or act shocked
    if (trigger === 'witnessed_body') {
      aiLogger.info('BODY WITNESSED - Triggering immediate decision (bypassing cooldowns)', {
        agentId: context.agentId,
        agentName: context.agentName,
        bodiesVisible: context.visibleBodies?.length ?? 0,
        role: context.role
      });

      // Generate a thought about finding the body (ignore cooldown for this)
      let thought: ThoughtEvent | undefined;
      thought = await this.generateThought(context, trigger, now);
      state.lastThoughtTime = now;

      // Now get an actual LLM decision about what to do
      // The agent sees the body and must decide: report, flee, self-report (impostor), etc.
      const decision = await this.getAgentDecision({
        ...context,
        // Add special flag so the prompt knows this is a body discovery situation
        bodyDiscoveryContext: true
      } as AIContext);

      aiLogger.info('Body discovery decision made', {
        agentId: context.agentId,
        agentName: context.agentName,
        goalType: decision.goalType,
        reasoning: decision.reasoning
      });

      return {
        thought,
        decision
      };
    }

    // Check cooldowns for non-emergency triggers
    const canThink = now - state.lastThoughtTime >= cooldowns.thoughtCooldown;

    if (!canThink && !canSpeak) {
      return {};
    }

    try {
      // Generate thought
      let thought: ThoughtEvent | undefined;
      if (canThink) {
        thought = await this.generateThought(context, trigger, now);
        state.lastThoughtTime = now;
        state.nextRandomThoughtTime = now + this.randomInterval();
      }

      // Maybe generate speech (social triggers or random)
      let speech: SpeechEvent | undefined;
      if (canSpeak && context.canSpeakTo.length > 0 && this.shouldSpeak(trigger, context)) {
        // Check if we should start a conversation instead of just broadcasting
        // Filter out own name to prevent self-talking
        const nearbyAgents = context.canSpeakTo.filter(name => 
          name.toLowerCase() !== context.agentName.toLowerCase()
        );
        if (nearbyAgents.length > 0 && Math.random() < 0.4) {
          // 40% chance to initiate a conversation instead of broadcast
          const targetName = nearbyAgents[Math.floor(Math.random() * nearbyAgents.length)];
          const speechResult = await this.generateConversationStarter(context, targetName, thought?.thought, now);
          if (speechResult) {
            speech = speechResult;
            state.lastSpeechTime = now;
          }
        } else {
          const speechResult = await this.generateSpeech(context, thought?.thought, now);
          if (speechResult) {
            speech = speechResult;
            state.lastSpeechTime = now;
          }
        }
      }

      // Update state tracking
      state.previouslyVisibleAgents = new Set(context.visibleAgents.map((a: { id: string }) => a.id));
      state.lastZone = context.currentZone;
      if (thought) {
        state.recentEvents.push(`Had thought: "${thought.thought.substring(0, 50)}..."`);
        if (state.recentEvents.length > 10) state.recentEvents.shift();
      }

      return { thought, speech };
    } catch (error) {
      aiLogger.error('Error generating AI content', { agentId: context.agentId, error: error as Error });
      return {};
    }
  }  /**
   * Get a full AI decision for agent behavior (goal selection)
   */
  async getAgentDecision(context: AIContext): Promise<AIDecision> {
    const systemPrompt = context.role === 'IMPOSTOR' 
      ? buildImpostorPrompt(context)
      : buildCrewmatePrompt(context);

    const userPrompt = this.buildUserPrompt(context);
    
    const startTime = Date.now();
    let rawResponse = '';

    try {
      const response = await this.aiClient.getDecision(systemPrompt, userPrompt, {
        temperature: 0.8,
        maxTokens: 100  // Reduced from 250 for faster responses (~900ms vs ~2.2s)
      });
      rawResponse = response;
      const decision = parseAIResponse(response, context);
      
      // Emit trace event for successful decision
      this.emitTraceEvent({
        id: this.generateTraceId(),
        timestamp: Date.now(),
        agentId: context.agentId,
        agentName: context.agentName,
        agentColor: this.getAgentColor(context.agentId),
        agentRole: context.role,
        requestType: 'decision',
        systemPrompt,
        userPrompt,
        rawResponse,
        parsedDecision: {
          goalType: decision.goalType,
          targetAgentId: decision.targetAgentId,
          targetTaskIndex: decision.targetTaskIndex,
          reasoning: decision.reasoning,
          thought: decision.thought,
          speech: decision.speech
        },
        context: {
          zone: context.currentZone,
          visibleAgents: context.visibleAgents.map(a => ({
            id: a.id,
            name: a.name,
            distance: a.distance
          })),
          assignedTasks: context.assignedTasks.map(t => ({
            taskType: t.taskType,
            room: t.room,
            isCompleted: t.isCompleted
          })),
          taskProgress: {
            completed: context.assignedTasks.filter(t => t.isCompleted).length,
            total: context.assignedTasks.length
          }
        },
        agentPositions: this.currentAgentPositions,
        durationMs: Date.now() - startTime,
        success: true
      });
      
      return decision;
    } catch (error) {
      // Silently fallback on timeout/queue errors (expected under load)
      const isExpectedError = error instanceof Error && 
        (error.name === 'AbortError' || 
         error.message.includes('ECONNREFUSED') ||
         error.message.includes('timed out') ||
         error.message.includes('Queue cleared'));
      if (!isExpectedError) {
        aiLogger.error('Decision error', { agentId: context.agentId, error: error as Error });
      }
      // Fallback to simple task-doing behavior
      return this.fallbackDecision(context);
    }
  }

  /**
   * Detect which triggers are active for an agent
   */
  private detectTriggers(context: AIContext, state: AgentAIState, now: number): ThoughtTrigger[] {
    const triggers: ThoughtTrigger[] = [];

    // Check for newly visible agents
    const currentVisible = new Set<string>(context.visibleAgents.map((a: { id: string }) => a.id));
    for (const agentId of currentVisible) {
      if (!state.previouslyVisibleAgents.has(agentId)) {
        triggers.push('agent_spotted');
        break;
      }
    }

    // Check for agents who left vision
    for (const agentId of state.previouslyVisibleAgents) {
      if (!currentVisible.has(agentId)) {
        triggers.push('agent_lost_sight');
        break;
      }
    }

    // Check for zone change
    if (context.currentZone && context.currentZone !== state.lastZone && state.lastZone !== null) {
      triggers.push('entered_room');
    }

    // Check for close pass (agents very close)
    for (const agent of context.visibleAgents) {
      if (agent.distance < this.config.closePassDistance) {
        triggers.push('passed_agent_closely');
        break;
      }
    }

    // Random thought timer
    if (now >= state.nextRandomThoughtTime) {
      triggers.push('idle_random');
    }

    // ===== BODY DISCOVERY - highest priority trigger! =====
    // Check if we see any bodies for the first time
    const currentVisibleBodies = new Set((context.visibleBodies || []).map(b => b.id));
    for (const bodyId of currentVisibleBodies) {
      if (!state.previouslyVisibleBodies.has(bodyId)) {
        // First time seeing this body! This is the pivotal moment.
        triggers.unshift('witnessed_body'); // Add to FRONT - highest priority!
        break;
      }
    }
    // Update tracking (do this AFTER checking so we detect first-sighting)
    state.previouslyVisibleBodies = currentVisibleBodies;

    return triggers;
  }

  /**
   * Generate an internal thought for the agent
   */
  private async generateThought(
    context: AIContext, 
    trigger: ThoughtTrigger, 
    timestamp: number
  ): Promise<ThoughtEvent> {
    const systemPrompt = buildThoughtPrompt(context, trigger);
    const userPrompt = this.buildThoughtUserPrompt(context, trigger);

    const startTime = Date.now();
    let thought: string;
    let usedFallback = false;
    try {
      thought = await this.aiClient.getDecision(systemPrompt, userPrompt, {
        temperature: 0.9,
        maxTokens: 100
      });
      // Clean up the thought
      thought = thought.replace(/^["']|["']$/g, '').trim();
      if (thought.length > 200) thought = thought.substring(0, 200) + '...';
    } catch {
      // Fallback thought
      thought = this.fallbackThought(context, trigger);
      usedFallback = true;
    }

    // Emit trace event for thought generation
    this.emitTraceEvent({
      id: this.generateTraceId(),
      timestamp: Date.now(),
      agentId: context.agentId,
      agentName: context.agentName,
      agentColor: this.getAgentColor(context.agentId),
      agentRole: context.role,
      requestType: 'thought',
      systemPrompt,
      userPrompt,
      rawResponse: thought,
      context: {
        zone: context.currentZone,
        visibleAgents: context.visibleAgents.map(a => ({
          id: a.id,
          name: a.name,
          distance: a.distance
        })),
        assignedTasks: context.assignedTasks.map(t => ({
          taskType: t.taskType,
          room: t.room,
          isCompleted: t.isCompleted
        })),
        taskProgress: {
          completed: context.assignedTasks.filter(t => t.isCompleted).length,
          total: context.assignedTasks.length
        }
      },
      agentPositions: this.currentAgentPositions,
      durationMs: Date.now() - startTime,
      success: !usedFallback
    });

    const event: ThoughtEvent = {
      id: `thought_${++this.thoughtIdCounter}`,
      agentId: context.agentId,
      timestamp,
      thought,
      trigger,
      context: context.currentZone || 'unknown'
    };

    this.pendingThoughts.push(event);
    return event;
  }

  /**
   * Generate speech for the agent
   */
  private async generateSpeech(
    context: AIContext,
    currentThought: string | undefined,
    timestamp: number
  ): Promise<SpeechEvent | null> {
    const systemPrompt = buildSpeechPrompt(context);
    // Filter own name from nearby agents list
    const othersNearby = context.canSpeakTo.filter(name =>
      name.toLowerCase() !== context.agentName.toLowerCase()
    );
    
    // Build context-aware user prompt
    let userPrompt: string;
    if (context.heardSpeechFrom && context.heardSpeechMessage) {
      // Responding to something someone said - emphasize this
      userPrompt = `Current thought: ${currentThought || 'Nothing in particular'}
${context.heardSpeechFrom} just said to you: "${context.heardSpeechMessage.substring(0, 80)}${context.heardSpeechMessage.length > 80 ? '...' : ''}"

RESPOND to ${context.heardSpeechFrom}! Reply to what they said.
You are ${context.agentName}. Keep it brief and natural (1-2 sentences).`;
    } else {
      // Normal speech - not responding to anyone specific
      userPrompt = `Current thought: ${currentThought || 'Nothing in particular'}
Nearby agents (NOT you): ${othersNearby.join(', ') || 'None'}
Remember: You are ${context.agentName}. Don't talk about yourself in third person.
What do you say out loud? Keep it brief and natural (1-2 sentences).`;
    }

    const startTime = Date.now();
    let message: string;
    let usedFallback = false;
    let silent = false;
    try {
      message = await this.aiClient.getDecision(systemPrompt, userPrompt, {
        temperature: 0.9,
        maxTokens: 60
      });
      message = message.replace(/^["']|["']$/g, '').trim();
      if (message.length > 150) message = message.substring(0, 150);

      // Clean up self-references (talking about yourself in third person)
      message = cleanSelfReferences(message, context.agentName);

      // Check for invalid mentions (agents not nearby)
      const invalidMentions = findInvalidMentions(message, context.agentName, othersNearby);
      if (invalidMentions.length > 0) {
        speechLogger.warn('Agent mentioned agents not nearby', { agentName: context.agentName, invalidMentions, message });
        // Don't block the speech, just log for debugging
        // The agent might be sharing information about someone they saw earlier
      }
    } catch (error) {
      // On timeout/queue errors, don't generate fallback speech - just stay quiet
      const isTimeoutOrQueue = error instanceof Error &&
        (error.name === 'AbortError' ||
         error.message.includes('timed out') ||
         error.message.includes('Queue cleared'));
      if (isTimeoutOrQueue) {
        silent = true;
        message = ''; // Stay silent on timeout/queue issues
      } else {
        message = this.fallbackSpeech(context);
        usedFallback = true;
      }
    }

    // Don't emit empty speech
    if (!message || message.trim() === '') {
      return null;
    }

    // Emit trace event for speech generation
    this.emitTraceEvent({
      id: this.generateTraceId(),
      timestamp: Date.now(),
      agentId: context.agentId,
      agentName: context.agentName,
      agentColor: this.getAgentColor(context.agentId),
      agentRole: context.role,
      requestType: 'speech',
      systemPrompt,
      userPrompt,
      rawResponse: message,
      context: {
        zone: context.currentZone,
        visibleAgents: context.visibleAgents.map(a => ({
          id: a.id,
          name: a.name,
          distance: a.distance
        })),
        assignedTasks: context.assignedTasks.map(t => ({
          taskType: t.taskType,
          room: t.room,
          isCompleted: t.isCompleted
        })),
        taskProgress: {
          completed: context.assignedTasks.filter(t => t.isCompleted).length,
          total: context.assignedTasks.length
        }
      },
      agentPositions: this.currentAgentPositions,
      durationMs: Date.now() - startTime,
      success: !usedFallback && !silent
    });

    const event: SpeechEvent = {
      id: `speech_${++this.speechIdCounter}`,
      speakerId: context.agentId,
      timestamp,
      message,
      position: context.currentPosition,
      hearingRadius: this.config.speechRange
    };

    this.pendingSpeech.push(event);
    return event;
  }

  /**
   * Generate a conversation-starting speech directed at a specific agent
   */
  private async generateConversationStarter(
    context: AIContext,
    targetName: string,
    currentThought: string | undefined,
    timestamp: number
  ): Promise<SpeechEvent | null> {
    const startTime = Date.now();
    const isImpostor = context.role === 'IMPOSTOR';
    
    const systemPrompt = isImpostor 
      ? this.buildImpostorConversationPrompt(context, targetName, 'small_talk')
      : this.buildCrewmateConversationPrompt(context, targetName, 'small_talk');

    const userPrompt = `You want to start a conversation with ${targetName}.
Current thought: ${currentThought || 'Nothing in particular'}
Location: ${context.currentZone || 'hallway'}

Start a conversation naturally. You might:
- Ask about what they've been up to
- Share something you observed
- Ask if they've seen anything suspicious
- Suggest teaming up
- Make small talk

Keep it brief (1-2 sentences). Start the conversation!`;

    let message: string;
    try {
      message = await this.aiClient.getDecision(systemPrompt, userPrompt, {
        temperature: 0.9,
        maxTokens: 80
      });
      message = message.replace(/^["']|["']$/g, '').trim();
      // Clean up any "Name:" prefix
      if (message.toLowerCase().startsWith(context.agentName.toLowerCase() + ':')) {
        message = message.substring(context.agentName.length + 1).trim();
      }
      if (message.length > 150) message = message.substring(0, 150);
      
      // Clean up self-references
      message = cleanSelfReferences(message, context.agentName);
    } catch (error) {
      // Fallback conversation starters
      const starters = [
        `Hey ${targetName}, what are you up to?`,
        `${targetName}, seen anything suspicious?`,
        `Hey ${targetName}, want to stick together?`,
        `What's up ${targetName}?`,
        `${targetName}, where have you been?`
      ];
      message = starters[Math.floor(Math.random() * starters.length)];
    }

    if (!message || message.trim() === '') {
      return null;
    }

    // Emit trace event for conversation starter
    // Note: conversationId is not set here because the conversation tracking
    // is only created when the target agent responds. The first turn is marked
    // as turn 1 and the conversationWith field shows who we're talking to.
    this.emitTraceEvent({
      id: this.generateTraceId(),
      timestamp: Date.now(),
      agentId: context.agentId,
      agentName: context.agentName,
      agentColor: this.getAgentColor(context.agentId),
      agentRole: context.role,
      requestType: 'conversation',
      conversationTurn: 1,
      conversationWith: targetName,
      systemPrompt,
      userPrompt,
      rawResponse: message,
      context: {
        zone: context.currentZone,
        visibleAgents: context.visibleAgents.map(a => ({
          id: a.id,
          name: a.name,
          distance: a.distance
        })),
        assignedTasks: context.assignedTasks.map(t => ({
          taskType: t.taskType,
          room: t.room,
          isCompleted: t.isCompleted
        })),
        taskProgress: {
          completed: context.assignedTasks.filter(t => t.isCompleted).length,
          total: context.assignedTasks.length
        }
      },
      agentPositions: this.currentAgentPositions,
      durationMs: Date.now() - startTime,
      success: true
    });

    // Start the conversation tracking
    // Note: We don't have the target agent ID here, just the name
    // The conversation will be created when the target responds

    const event: SpeechEvent = {
      id: `speech_${++this.speechIdCounter}`,
      speakerId: context.agentId,
      timestamp,
      message,
      position: context.currentPosition,
      hearingRadius: this.config.speechRange
    };

    this.pendingSpeech.push(event);
    speechLogger.info('Starting conversation', { agentName: context.agentName, targetName, messagePreview: message.substring(0, 50) });
    return event;
  }

  /**
   * Build user prompt for decision-making
   */
  private buildUserPrompt(context: AIContext): string {
    const taskStatus = context.assignedTasks
      .map((t: TaskAssignment, i: number) => `${i + 1}. ${t.taskType} in ${t.room} - ${t.isCompleted ? 'DONE' : 'TODO'}`)
      .join('\n') || 'No tasks assigned';

    const visibleInfo = context.visibleAgents
      .map((a: { name: string; zone: string | null; distance: number }) => `- ${a.name} in ${a.zone || 'hallway'} (${Math.round(a.distance)} units away)`)
      .join('\n') || 'No one visible';

    // Build impostor-specific kill context if applicable
    let impostorKillContext = '';
    let canKillNow = false;
    let hasTargetInKillRange = false;
    let isOnCooldown = false;
    let huntingTarget: string | null = null;
    
    if (context.role === 'IMPOSTOR' && context.impostorContext) {
      const imp = context.impostorContext;
      isOnCooldown = imp.killCooldownRemaining > 0;
      canKillNow = imp.canKill && imp.targetsInKillRange.length > 0;
      hasTargetInKillRange = imp.targetsInKillRange.length > 0;
      
      // Check if currently hunting someone
      if (context.currentGoalType === 'HUNT' && context.huntTargetId) {
        huntingTarget = context.huntTargetName || context.huntTargetId;
      }
      if (imp.canKill && imp.targetsInKillRange.length > 0) {
        const isolatedTargets = imp.targetsInKillRange.filter(t => t.isIsolated);
        if (isolatedTargets.length > 0) {
          impostorKillContext = `\n\nðŸ”ªðŸ”ªðŸ”ª KILL NOW! ${isolatedTargets[0].name} is ISOLATED and within kill range (${isolatedTargets[0].distance?.toFixed(0) || '?'} units)!
You MUST use GOAL: KILL and TARGET: ${isolatedTargets[0].name}`;
        } else {
          impostorKillContext = `\n\nTargets within kill range but have witnesses: ${imp.targetsInKillRange.map(t => `${t.name} (${t.witnessCount} witnesses)`).join(', ')}`;
        }
      } else if (imp.killCooldownRemaining > 0) {
        impostorKillContext = `\n\nâ±ï¸ Kill on cooldown: ${imp.killCooldownRemaining.toFixed(0)}s remaining. Cannot kill yet.`;
      } else if (imp.targetsInKillRange.length === 0 && context.visibleAgents.length > 0) {
        // Visible but not in kill range - suggest HUNT
        const closestTarget = context.visibleAgents
          .filter(a => !imp.fellowImpostors?.some(f => f.name === a.name))
          .sort((a, b) => a.distance - b.distance)[0];
        if (closestTarget) {
          impostorKillContext = `\n\nðŸŽ¯ ${closestTarget.name} visible but out of kill range (${Math.round(closestTarget.distance)} units away, need < 90 units).\nUse HUNT to chase them down!`;
        }
      }
      
      // Add hunt status if currently hunting
      if (huntingTarget) {
        impostorKillContext += `\n\nðŸ” CURRENTLY HUNTING: ${huntingTarget} - continue pursuit until in kill range!`;
      }
    }

    // Build dynamic goal options based on current state
    let goalOptions: string;
    
    // Check if this is a body discovery situation - REPORT_BODY is the expected response!
    const isBodyDiscovery = context.bodyDiscoveryContext === true;
    
    if (isBodyDiscovery) {
      // Body discovery - emphasize REPORT_BODY as the primary option
      if (context.role === 'IMPOSTOR') {
        goalOptions = 'REPORT_BODY/SELF_REPORT/FLEE_BODY/WANDER';
      } else {
        goalOptions = 'REPORT_BODY/FLEE_BODY/WANDER';
      }
    } else if (context.role === 'IMPOSTOR') {
      const availableGoals: string[] = [];

      // KILL only available if: not on cooldown AND target in range
      if (canKillNow) {
        availableGoals.push('KILL');
      }

      // HUNT available if: not on cooldown OR already hunting (to continue)
      if (!isOnCooldown || huntingTarget) {
        availableGoals.push('HUNT');
      }

      // Always available options for impostors
      availableGoals.push('GO_TO_TASK', 'WANDER', 'FOLLOW_AGENT', 'AVOID_AGENT', 'IDLE', 'SPEAK');

      goalOptions = availableGoals.join('/');
    } else {
      goalOptions = 'GO_TO_TASK/WANDER/FOLLOW_AGENT/AVOID_AGENT/IDLE/SPEAK';
    }

    // Build body discovery section if applicable
    let bodyDiscoverySection = '';
    if (isBodyDiscovery && context.visibleBodies && context.visibleBodies.length > 0) {
      const bodyInfo = context.visibleBodies.map(b =>
        `${b.victimName} (in ${b.zone || 'unknown location'}, ${Math.round(b.distance)} units away)`
      ).join(', ');
      bodyDiscoverySection = `
💀💀💀 DEAD BODY FOUND! 💀💀💀
Bodies visible: ${bodyInfo}

THIS IS AN EMERGENCY! As a responsible crewmate, you should REPORT THIS BODY!
Your response MUST be: GOAL: REPORT_BODY

`;
    }

    // Build witness memory section - CRITICAL information if agent saw a kill!
    let witnessSection = '';
    if (context.witnessMemory && context.witnessMemory.sawKill) {
      const killerColorName = context.witnessMemory.suspectedKillerColor !== null
        ? COLOR_NAMES[context.witnessMemory.suspectedKillerColor] || `Unknown (color ${context.witnessMemory.suspectedKillerColor})`
        : null;
      const killerInfo = killerColorName
        ? `You SAW the killer - it was ${killerColorName}! (${Math.round(context.witnessMemory.colorConfidence * 100)}% certain)`
        : 'You saw the kill but couldn\'t identify the killer clearly!';
      witnessSection = `
🔴🔴🔴 CRITICAL: YOU WITNESSED A MURDER! 🔴🔴🔴
Location: ${context.witnessMemory.location || 'Unknown'}
${killerInfo}

This is DAMNING evidence! You must TELL EVERYONE and REPORT THIS!

`;
    }

    // Include memory context with timestamped history
    const memorySection = context.memoryContext 
      ? `\nYOUR MEMORY (what you've seen and heard):\n${context.memoryContext}\n`
      : '';

    return `CURRENT SITUATION:
Location: ${context.currentZone || 'Hallway'}
Position: (${Math.round(context.currentPosition.x)}, ${Math.round(context.currentPosition.y)})
${bodyDiscoverySection}${witnessSection}
MY TASKS:
${taskStatus}
Current task: ${context.currentTaskIndex !== null ? context.assignedTasks[context.currentTaskIndex]?.taskType : (huntingTarget ? `HUNTING ${huntingTarget}` : 'None selected')}

VISIBLE AGENTS:
${visibleInfo}${impostorKillContext}
${memorySection}
What should I do next?

RESPOND EXACTLY LIKE THIS (replace the placeholders with your actual choice):
GOAL: <choose one: ${goalOptions}>
TARGET: <task number 1-${context.assignedTasks.length}, agent name, or none>
REASONING: <your explanation>
THOUGHT: <your internal thought, 1 sentence>`;
  }

  /**
   * Build user prompt for thought generation
   */
  private buildThoughtUserPrompt(context: AIContext, trigger: ThoughtTrigger): string {
    // Build dynamic trigger description
    let triggerDescription: string;
    
    if (trigger === 'heard_speech' && context.heardSpeechFrom && context.heardSpeechMessage) {
      // Enhanced description for heard speech - include WHO said WHAT
      triggerDescription = `${context.heardSpeechFrom} just said: "${context.heardSpeechMessage.substring(0, 100)}${context.heardSpeechMessage.length > 100 ? '...' : ''}"`;
    } else {
      const triggerDescriptions: Partial<Record<ThoughtTrigger, string>> = {
        'arrived_at_destination': 'You just arrived at your destination.',
        'task_completed': 'You just finished a task.',
        'task_started': 'You just started working on a task.',
        'agent_spotted': `You just noticed ${context.visibleAgents[0]?.name || 'someone'} nearby.`,
        'agent_lost_sight': 'Someone you were watching just left your view.',
        'entered_room': `You just entered ${context.currentZone || 'a new area'}.`,
        'idle_random': 'You have a moment to think.',
        'heard_speech': 'You heard someone talking nearby.',
        'passed_agent_closely': `You just passed close to ${context.visibleAgents.find((a: { name: string; distance: number }) => a.distance < 50)?.name || 'someone'}.`,
        'witnessed_body': '💀 DEAD BODY! You just discovered a corpse! You must REPORT this immediately using GOAL: REPORT_BODY!',
        'task_in_action_radius': 'A task location is nearby.',
        'target_entered_kill_range': '\u{1F52A} A crewmate just entered your kill range! Quick - decide: kill them, use them as an alibi, or let them pass?',
        'near_vent': 'You noticed a vent nearby.',
        'entered_vent': 'You just entered a vent!',
        'exited_vent': 'You just exited a vent.',
        'witnessed_vent_activity': 'You just saw someone use a vent!',
        'alone_with_vent': 'You are alone near a vent.',
      };
      triggerDescription = triggerDescriptions[trigger] || 'Something happened.';
    }

    // For heard_speech, add response guidance
    const responseGuidance = trigger === 'heard_speech'
      ? `\nConsider: Do I respond? What should I say back? Is this suspicious? Should I engage or walk away?`
      : '';

    // Include brief memory context for thoughts
    const memoryHint = context.memoryContext 
      ? `\nRecent memory:\n${context.memoryContext.split('\n').slice(0, 8).join('\n')}`
      : '';

    return `${triggerDescription}
Location: ${context.currentZone || 'Hallway'}
Tasks done: ${context.assignedTasks.filter((t: TaskAssignment) => t.isCompleted).length}/${context.assignedTasks.length}
Visible agents: ${context.visibleAgents.map((a: { name: string }) => a.name).join(', ') || 'None'}${responseGuidance}
${memoryHint}
What are you thinking? (One brief internal thought, stay in character)`;
  }

  /**
   * Should this agent speak given the trigger?
   */
  private shouldSpeak(trigger: ThoughtTrigger, context: AIContext): boolean {
    // Filter out own name - can't talk to yourself
    const othersNearby = context.canSpeakTo.filter(name => 
      name.toLowerCase() !== context.agentName.toLowerCase()
    );
    
    // Social triggers - high chance to speak when interacting with others
    const socialTriggers: ThoughtTrigger[] = ['agent_spotted', 'passed_agent_closely', 'heard_speech'];
    if (socialTriggers.includes(trigger) && othersNearby.length > 0) {
      return Math.random() < 0.50; // 50% chance on social triggers - be chatty!
    }
    // Moderate chance on other triggers when others are nearby
    if (othersNearby.length > 0) {
      return Math.random() < 0.20; // 20% chance when someone can hear
    }
    // Don't talk to yourself
    return false;
  }

  /**
   * Random interval for idle thoughts - uses dynamic cooldowns
   * Adds per-call jitter to prevent synchronization
   */
  private randomInterval(): number {
    const cooldowns = this.getEffectiveCooldowns();
    const [min, max] = cooldowns.randomInterval;
    // Add extra jitter (Â±20%) to break any synchronization patterns
    const jitterFactor = 0.8 + (Math.random() * 0.4); // 0.8 to 1.2
    return (min + Math.random() * (max - min)) * jitterFactor;
  }

  /**
   * Fallback decision when AI fails
   */
  private fallbackDecision(context: AIContext): AIDecision {
    // Find first incomplete task
    const nextTaskIndex = context.assignedTasks.findIndex((t: TaskAssignment) => !t.isCompleted);
    if (nextTaskIndex !== -1) {
      return {
        goalType: 'GO_TO_TASK',
        targetTaskIndex: nextTaskIndex,
        reasoning: 'Continuing with my tasks'
      };
    }
    return {
      goalType: 'WANDER',
      reasoning: 'All tasks done, exploring'
    };
  }

  /**
   * Fallback thought when AI fails
   */
  private fallbackThought(context: AIContext, trigger: ThoughtTrigger): string {
    // Use Partial since not all triggers need fallbacks
    const fallbacks: Partial<Record<ThoughtTrigger, string[]>> = {
      'arrived_at_destination': ['Here we go.', 'Made it.', 'Time to get to work.'],
      'task_completed': ['One down.', 'Task done!', 'That\'s progress.'],
      'task_started': ['Let me focus on this.', 'Okay, let\'s do this.'],
      'agent_spotted': ['Oh, someone\'s here.', 'Not alone...', 'Company.'],
      'agent_lost_sight': ['Where did they go?', 'They left.', 'Gone.'],
      'entered_room': [`${context.currentZone || 'New area'}...`, 'Different scenery.'],
      'idle_random': ['Hmm...', 'What next?', 'Thinking...', 'Stay focused.'],
      'witnessed_body': ['Oh no... a body!', 'Someone\'s DEAD!', 'I need to report this!', 'BODY!'],
      'heard_speech': context.heardSpeechFrom 
        ? [`${context.heardSpeechFrom} is talking to me...`, `What does ${context.heardSpeechFrom} want?`, `Should I respond to ${context.heardSpeechFrom}?`]
        : ['What was that?', 'Someone said something.', 'Did they say something to me?'],
      'passed_agent_closely': ['Hey there.', 'Passing by.', 'Excuse me.'],
      'task_in_action_radius': ['Task nearby.', 'Could work on this.'],
      'target_entered_kill_range': ['They\'re right here...', 'Perfect opportunity?', 'Kill or wait?', 'Now or never...'],
      'near_vent': ['Vent nearby...', 'Could use that vent.'],
      'entered_vent': ['In the vent now.', 'Safe in here.'],
      'exited_vent': ['Out of the vent.', 'Anyone see that?'],
      'witnessed_vent_activity': ['Did I just see that?!', 'They vented!', 'Impostor!'],
      'alone_with_vent': ['No one around...', 'Vent opportunity.'],
    };
    const options = fallbacks[trigger] || ['...'];
    return options[Math.floor(Math.random() * options.length)];
  }

  /**
   * Fallback speech when AI fails
   */
  private fallbackSpeech(context: AIContext): string {
    const options = [
      'Hey.',
      'Hi there.',
      'Anyone seen anything?',
      'Just doing tasks.',
      'All good here.',
      `Heading to ${context.currentZone || 'somewhere'}.`
    ];
    return options[Math.floor(Math.random() * options.length)];
  }

  /**
   * Get and clear pending thoughts (for snapshot)
   */
  flushPendingThoughts(): ThoughtEvent[] {
    const thoughts = [...this.pendingThoughts];
    this.pendingThoughts = [];
    return thoughts;
  }

  /**
   * Get and clear pending speech (for snapshot)
   */
  flushPendingSpeech(): SpeechEvent[] {
    const speech = [...this.pendingSpeech];
    this.pendingSpeech = [];
    return speech;
  }

  /**
   * Notify service of external events (task completion, arrival, etc.)
   */
  notifyEvent(agentId: string, event: ThoughtTrigger): void {
    const state = this.agentStates.get(agentId);
    if (state) {
      // Reset the random thought timer on significant events
      // This prevents thought spam right after events
      const cooldowns = this.getEffectiveCooldowns();
      state.nextRandomThoughtTime = Date.now() + cooldowns.thoughtCooldown;
    }
  }

  // ========== Conversation System ==========

  /**
   * Start or continue a conversation between agents
   * Returns the conversation ID if one was started or is active
   */
  startConversation(initiatorId: string, initiatorName: string, targetName: string, targetId: string, initialMessage: string): string {
    // Check if there's already an active conversation between these two
    const existingConvId = this.findActiveConversation(initiatorId, targetId);
    if (existingConvId) {
      return existingConvId;
    }

    // Create new conversation with random max turns (3-10)
    const maxTurns = 3 + Math.floor(Math.random() * 8); // 3-10 turns
    const convId = `conv_${++this.conversationIdCounter}_${Date.now()}`;
    
    const conversation: ActiveConversation = {
      id: convId,
      participants: [initiatorName, targetName],
      participantIds: [initiatorId, targetId],
      startTime: Date.now(),
      lastActivityTime: Date.now(),
      turns: [{
        speakerName: initiatorName,
        speakerId: initiatorId,
        message: initialMessage,
        timestamp: Date.now()
      }],
      maxTurns,
      topic: this.inferConversationTopic(initialMessage),
      isActive: true
    };

    this.activeConversations.set(convId, conversation);
    speechLogger.info('Conversation started', { initiator: initiatorName, target: targetName, maxTurns, messagePreview: initialMessage.substring(0, 50) });
    
    return convId;
  }

  /**
   * Find an existing active conversation between two agents
   */
  private findActiveConversation(agentId1: string, agentId2: string): string | null {
    for (const [convId, conv] of this.activeConversations) {
      if (conv.isActive && 
          conv.participantIds.includes(agentId1) && 
          conv.participantIds.includes(agentId2)) {
        return convId;
      }
    }
    return null;
  }

  /**
   * Get active conversation for an agent
   */
  getActiveConversationForAgent(agentId: string): ActiveConversation | null {
    for (const conv of this.activeConversations.values()) {
      if (conv.isActive && conv.participantIds.includes(agentId)) {
        return conv;
      }
    }
    return null;
  }

  /**
   * Check if agent is currently in a conversation
   */
  isInConversation(agentId: string): boolean {
    return this.getActiveConversationForAgent(agentId) !== null;
  }

  /**
   * Add a reply to an ongoing conversation
   */
  addConversationReply(convId: string, speakerId: string, speakerName: string, message: string): boolean {
    const conv = this.activeConversations.get(convId);
    if (!conv || !conv.isActive) return false;

    conv.turns.push({
      speakerName,
      speakerId,
      message,
      timestamp: Date.now()
    });
    conv.lastActivityTime = Date.now();

    speechLogger.debug('Conversation turn', { speakerName, turn: conv.turns.length, maxTurns: conv.maxTurns, messagePreview: message.substring(0, 50) });

    // Check if conversation should end
    if (conv.turns.length >= conv.maxTurns) {
      this.endConversation(convId, 'max_turns_reached');
    }

    return true;
  }

  /**
   * End a conversation
   */
  endConversation(convId: string, reason: string): void {
    const conv = this.activeConversations.get(convId);
    if (conv) {
      conv.isActive = false;
      speechLogger.info('Conversation ended', { reason, participants: conv.participants, totalTurns: conv.turns.length });
      
      // Clean up old conversations (keep for 30 seconds for reference)
      setTimeout(() => {
        this.activeConversations.delete(convId);
      }, 30000);
    }
  }

  /**
   * Generate a conversational response for an agent
   * This is called when an agent needs to reply in an ongoing conversation
   */
  async generateConversationReply(
    context: AIContext,
    conversation: ActiveConversation,
    timestamp: number
  ): Promise<SpeechEvent | null> {
    const startTime = Date.now();
    const isImpostor = context.role === 'IMPOSTOR';
    const otherParticipant = conversation.participants.find(p => p !== context.agentName) || 'someone';
    
    // Build conversation history for context
    const conversationHistory = conversation.turns
      .map(t => `${t.speakerName}: "${t.message}"`)
      .join('\n');

    const turnNumber = conversation.turns.length + 1;
    const isLastTurn = turnNumber >= conversation.maxTurns;

    const systemPrompt = isImpostor 
      ? this.buildImpostorConversationPrompt(context, otherParticipant, conversation.topic)
      : this.buildCrewmateConversationPrompt(context, otherParticipant, conversation.topic);

    const userPrompt = `ONGOING CONVERSATION with ${otherParticipant}:
${conversationHistory}

This is turn ${turnNumber} of ${conversation.maxTurns}.${isLastTurn ? ' This is your last reply - wrap up naturally.' : ''}

How do you respond? Keep it natural and brief (1-2 sentences). Stay in character.
${isImpostor ? 'Remember: Deflect suspicion, blend in, maybe cast doubt on others.' : 'Remember: Share info, ask questions, build trust or express suspicion if warranted.'}`;

    let message: string;
    try {
      message = await this.aiClient.getDecision(systemPrompt, userPrompt, {
        temperature: 0.9,
        maxTokens: 80
      });
      message = message.replace(/^["']|["']$/g, '').trim();
      // Clean up any "Name:" prefix the LLM might add
      if (message.toLowerCase().startsWith(context.agentName.toLowerCase() + ':')) {
        message = message.substring(context.agentName.length + 1).trim();
      }
      if (message.length > 150) message = message.substring(0, 150);
      
      // Clean up self-references
      message = cleanSelfReferences(message, context.agentName);
    } catch (error) {
      // On errors, use a simple continuation
      message = this.getFallbackConversationReply(context, conversation.topic, isImpostor);
    }

    if (!message || message.trim() === '') {
      return null;
    }

    // Use turn number already calculated above (this will be the turn we're about to add)
    const otherParticipantName = conversation.participants.find(p => p !== context.agentName) || 'someone';

    // Emit trace event for conversation reply
    this.emitTraceEvent({
      id: this.generateTraceId(),
      timestamp: Date.now(),
      agentId: context.agentId,
      agentName: context.agentName,
      agentColor: this.getAgentColor(context.agentId),
      agentRole: context.role,
      requestType: 'conversation',
      conversationId: conversation.id,
      conversationTurn: turnNumber,
      conversationWith: otherParticipantName,
      systemPrompt,
      userPrompt,
      rawResponse: message,
      context: {
        zone: context.currentZone,
        visibleAgents: context.visibleAgents.map(a => ({
          id: a.id,
          name: a.name,
          distance: a.distance
        })),
        assignedTasks: context.assignedTasks.map(t => ({
          taskType: t.taskType,
          room: t.room,
          isCompleted: t.isCompleted
        })),
        taskProgress: {
          completed: context.assignedTasks.filter(t => t.isCompleted).length,
          total: context.assignedTasks.length
        }
      },
      agentPositions: this.currentAgentPositions,
      durationMs: Date.now() - startTime,
      success: true
    });

    // Add to conversation
    this.addConversationReply(conversation.id, context.agentId, context.agentName, message);

    // Create speech event
    const event: SpeechEvent = {
      id: `speech_${++this.speechIdCounter}`,
      speakerId: context.agentId,
      timestamp,
      message,
      position: context.currentPosition,
      hearingRadius: this.config.speechRange
    };

    this.pendingSpeech.push(event);
    return event;
  }

  /**
   * Build conversation prompt for crewmates
   */
  private buildCrewmateConversationPrompt(context: AIContext, otherAgent: string, topic?: string): string {
    return `You are ${context.agentName}. YOUR NAME IS ${context.agentName}. You are a CREWMATE in Among Us.
You are having a conversation with ${otherAgent}. ${otherAgent} is a DIFFERENT person than you.

IMPORTANT: When you talk about yourself, use "I" or "me". When you talk about ${otherAgent}, use their name or "you".
NEVER say "${context.agentName} did" or "${context.agentName} is" - use "I did" or "I am" instead.

YOUR GOALS IN THIS CONVERSATION:
- Share useful information about what you've seen
- Ask questions to gather information about others
- Express suspicions if you have them (with reasons)
- Build alliances with trustworthy players
- If ${otherAgent} seems suspicious, probe carefully

CONTEXT:
- Location: ${context.currentZone || 'Unknown'}
- Your suspicion of ${otherAgent}: ${context.suspicionLevels?.[otherAgent] || 'neutral'}
- Topic: ${topic || 'general discussion'}
${context.memoryContext ? `\nYour memories:\n${context.memoryContext}` : ''}

Respond naturally like a real Among Us player would. Be conversational, not robotic.`;
  }

  /**
   * Build conversation prompt for impostors
   */
  private buildImpostorConversationPrompt(context: AIContext, otherAgent: string, topic?: string): string {
    // Get personality for speech style
    const personality = context.personalityId ? getPersonalityById(context.personalityId) : null;
    const speechStyleHint = personality ? `
YOUR SPEECH STYLE (${personality.name}):
${personality.speechQuirks.map(q => `- ${q}`).join('\n')}
Deception style: ${personality.deceptionStyle || 'blend in naturally'}
Deflection style: ${personality.deflectionStyle || 'stay calm and deny'}` : '';

    // Include memory context
    const memoryHint = context.memoryContext 
      ? `\nWHAT YOU'VE SEEN/HEARD:\n${context.memoryContext.substring(0, 300)}` 
      : '';

    return `You are ${context.agentName}. YOUR NAME IS ${context.agentName}. You are secretly an IMPOSTOR in Among Us.
You are having a conversation with ${otherAgent}. ${otherAgent} is a DIFFERENT person than you.

IMPORTANT: When you talk about yourself, use "I" or "me". When you talk about ${otherAgent}, use their name or "you".
NEVER say "${context.agentName} did" or "${context.agentName} is" - use "I did" or "I am" instead.

${speechStyleHint}
${memoryHint}

YOUR GOALS IN THIS CONVERSATION:
- Appear innocent and helpful
- Deflect any suspicion away from yourself
- Subtly cast doubt on other crewmates if possible
- Don't be too eager to accuse (that's suspicious)
- If accused, defend calmly with plausible alibis
- Reference things you've "seen" to build credibility

CONTEXT:
- Location: ${context.currentZone || 'Unknown'}
- You are secretly an impostor!
- Topic: ${topic || 'general discussion'}

SPEECH GUIDELINES:
- Keep responses SHORT (1-2 sentences max)
- Use casual Among Us speech: "sus", "where", "who", etc.
- NO emojis. NO "Let's chat about something fun". NO generic pleasantries.
- Reference locations and tasks naturally

Be a convincing crewmate. Don't overdo the helpfulness. Act natural and blend in.`;
  }

  /**
   * Fallback replies when LLM fails
   */
  private getFallbackConversationReply(context: AIContext, topic?: string, isImpostor?: boolean): string {
    const crewmateReplies = [
      'Yeah, I agree.',
      'Hmm, interesting. I\'ll keep an eye out.',
      'I was just doing my tasks.',
      'Have you seen anyone acting weird?',
      'Let\'s stick together.',
      'Good to know.',
      'I\'m not sure, to be honest.',
      'We should be careful.'
    ];

    const impostorReplies = [
      'Yeah, totally.',
      'I\'ve been doing tasks all game.',
      'I haven\'t seen anything suspicious.',
      'Maybe we should check on others.',
      'I was in electrical earlier.',
      'Good point.',
      'I think we\'re good here.',
      'Agreed.'
    ];

    const options = isImpostor ? impostorReplies : crewmateReplies;
    return options[Math.floor(Math.random() * options.length)];
  }

  /**
   * Infer the topic of a conversation from initial message
   */
  private inferConversationTopic(message: string): ActiveConversation['topic'] {
    const lower = message.toLowerCase();
    if (lower.includes('sus') || lower.includes('suspicious') || lower.includes('saw') || lower.includes('vent')) {
      return 'suspicion';
    }
    if (lower.includes('where') || lower.includes('what were you') || lower.includes('alibi')) {
      return 'alibi';
    }
    if (lower.includes('task') || lower.includes('working on')) {
      return 'task_info';
    }
    if (lower.includes('accuse') || lower.includes('you\'re the') || lower.includes('it\'s you')) {
      return 'accusation';
    }
    if (lower.includes('wasn\'t me') || lower.includes('i swear') || lower.includes('not me')) {
      return 'defense';
    }
    return 'small_talk';
  }

  /**
   * Clean up stale conversations (called periodically)
   */
  cleanupStaleConversations(): void {
    const now = Date.now();
    const staleTimeout = 30000; // 30 seconds of inactivity

    for (const [convId, conv] of this.activeConversations) {
      if (conv.isActive && (now - conv.lastActivityTime) > staleTimeout) {
        this.endConversation(convId, 'inactivity');
      }
    }
  }

  /**
   * Get conversation statistics for debugging/monitoring
   */
  getConversationStats(): { active: number; total: number; avgTurns: number } {
    let totalTurns = 0;
    let completedConvs = 0;
    let activeCount = 0;

    for (const conv of this.activeConversations.values()) {
      if (conv.isActive) {
        activeCount++;
      } else {
        totalTurns += conv.turns.length;
        completedConvs++;
      }
    }

    return {
      active: activeCount,
      total: this.activeConversations.size,
      avgTurns: completedConvs > 0 ? totalTurns / completedConvs : 0
    };
  }
}

// Singleton instance
let serviceInstance: AIDecisionService | null = null;

export function getAIDecisionService(aiServerUrl?: string): AIDecisionService {
  if (!serviceInstance) {
    serviceInstance = new AIDecisionService(aiServerUrl);
  }
  return serviceInstance;
}

export function resetAIDecisionService(): void {
  serviceInstance = null;
}

