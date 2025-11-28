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
import { 
  buildCrewmatePrompt, 
  buildImpostorPrompt, 
  buildThoughtPrompt,
  buildSpeechPrompt,
  parseAIResponse 
} from './prompts/AgentPrompts.js';
import { getLLMQueue, type LLMQueueStats } from './LLMQueue.js';

// ========== AI Model Client (inline for server-side) ==========

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

    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
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
  thoughtCooldownMs: number;      // Min time between thoughts per agent
  speechCooldownMs: number;       // Min time between speech per agent
  randomThoughtIntervalMs: [number, number]; // [min, max] for random thoughts
  speechRange: number;            // Units within which speech is heard
  closePassDistance: number;      // Distance to trigger "passed agent closely"
}

const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  thoughtCooldownMs: 10000,       // 10 seconds between thoughts
  speechCooldownMs: 45000,        // 45 seconds between speech (less spammy)
  randomThoughtIntervalMs: [15000, 45000], // Random thought every 15-45 seconds
  speechRange: 150,               // 150 units hearing range
  closePassDistance: 50           // 50 units = close pass
};

// ========== Agent State Tracking ==========

interface AgentAIState {
  lastThoughtTime: number;
  lastSpeechTime: number;
  nextRandomThoughtTime: number;
  previouslyVisibleAgents: Set<string>;
  lastZone: string | null;
  recentEvents: string[];
  conversationHistory: ChatMessage[];
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

  constructor(aiServerUrl?: string, config?: Partial<TriggerConfig>) {
    this.aiClient = new AIModelClient(aiServerUrl);
    this.config = { ...DEFAULT_TRIGGER_CONFIG, ...config };
    this.agentStates = new Map();
    this.pendingThoughts = [];
    this.pendingSpeech = [];
    this.thoughtIdCounter = 0;
    this.speechIdCounter = 0;
  }

  /**
   * Get LLM queue statistics for monitoring
   */
  getQueueStats(): LLMQueueStats {
    return getLLMQueue(10000).getStats();
  }

  /**
   * Initialize state tracking for an agent
   */
  initializeAgent(agentId: string): void {
    const now = Date.now();
    this.agentStates.set(agentId, {
      lastThoughtTime: 0,
      lastSpeechTime: 0,
      nextRandomThoughtTime: now + this.randomInterval(),
      previouslyVisibleAgents: new Set(),
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
    const triggers = this.detectTriggers(context, state, now);

    // No triggers? No AI call needed
    if (triggers.length === 0) {
      return {};
    }

    // Check cooldowns
    const canThink = now - state.lastThoughtTime >= this.config.thoughtCooldownMs;
    const canSpeak = now - state.lastSpeechTime >= this.config.speechCooldownMs;

    if (!canThink && !canSpeak) {
      return {};
    }

    // Pick highest priority trigger
    const trigger = triggers[0];
    
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
        const speechResult = await this.generateSpeech(context, thought?.thought, now);
        if (speechResult) {
          speech = speechResult;
          state.lastSpeechTime = now;
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
      console.error(`[AIDecisionService] Error generating AI content for ${context.agentId}:`, error);
      return {};
    }
  }

  /**
   * Get a full AI decision for agent behavior (goal selection)
   */
  async getAgentDecision(context: AIContext): Promise<AIDecision> {
    const systemPrompt = context.role === 'IMPOSTOR' 
      ? buildImpostorPrompt(context)
      : buildCrewmatePrompt(context);

    const userPrompt = this.buildUserPrompt(context);

    try {
      const response = await this.aiClient.getDecision(systemPrompt, userPrompt, {
        temperature: 0.8,
        maxTokens: 100  // Reduced from 250 for faster responses (~900ms vs ~2.2s)
      });

      return parseAIResponse(response, context);
    } catch (error) {
      // Silently fallback on timeout/queue errors (expected under load)
      const isExpectedError = error instanceof Error && 
        (error.name === 'AbortError' || 
         error.message.includes('ECONNREFUSED') ||
         error.message.includes('timed out') ||
         error.message.includes('Queue cleared'));
      if (!isExpectedError) {
        console.error(`[AIDecisionService] Decision error for ${context.agentId}:`, error);
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

    let thought: string;
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
    }

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
    const userPrompt = `Current thought: ${currentThought || 'Nothing in particular'}
Nearby agents: ${context.canSpeakTo.join(', ') || 'None'}
What do you say out loud? Keep it brief and natural (1-2 sentences).`;

    let message: string;
    try {
      message = await this.aiClient.getDecision(systemPrompt, userPrompt, {
        temperature: 0.9,
        maxTokens: 60
      });
      message = message.replace(/^["']|["']$/g, '').trim();
      if (message.length > 150) message = message.substring(0, 150);
    } catch (error) {
      // On timeout/queue errors, don't generate fallback speech - just stay quiet
      const isTimeoutOrQueue = error instanceof Error && 
        (error.name === 'AbortError' || 
         error.message.includes('timed out') ||
         error.message.includes('Queue cleared'));
      if (isTimeoutOrQueue) {
        return null; // Stay silent on timeout/queue issues
      } else {
        message = this.fallbackSpeech(context);
      }
    }

    // Don't emit empty speech
    if (!message || message.trim() === '') {
      return null;
    }

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
   * Build user prompt for decision-making
   */
  private buildUserPrompt(context: AIContext): string {
    const taskStatus = context.assignedTasks
      .map((t: TaskAssignment, i: number) => `${i + 1}. ${t.taskType} in ${t.room} - ${t.isCompleted ? 'DONE' : 'TODO'}`)
      .join('\n');

    const visibleInfo = context.visibleAgents
      .map((a: { name: string; zone: string | null; distance: number }) => `- ${a.name} in ${a.zone || 'hallway'} (${Math.round(a.distance)} units away)`)
      .join('\n') || 'No one visible';

    return `CURRENT SITUATION:
Location: ${context.currentZone || 'Hallway'}
Position: (${Math.round(context.currentPosition.x)}, ${Math.round(context.currentPosition.y)})

MY TASKS:
${taskStatus}
Current task: ${context.currentTaskIndex !== null ? context.assignedTasks[context.currentTaskIndex]?.taskType : 'None selected'}

VISIBLE AGENTS:
${visibleInfo}

What should I do next? Respond with your decision in this format:
GOAL: [GO_TO_TASK/WANDER/FOLLOW_AGENT/AVOID_AGENT/IDLE/SPEAK]
TARGET: [task number, agent name, or "none"]
REASONING: [brief explanation]
THOUGHT: [your internal thought, 1 sentence]`;
  }

  /**
   * Build user prompt for thought generation
   */
  private buildThoughtUserPrompt(context: AIContext, trigger: ThoughtTrigger): string {
    const triggerDescriptions: Record<ThoughtTrigger, string> = {
      'arrived_at_destination': 'You just arrived at your destination.',
      'task_completed': 'You just finished a task.',
      'task_started': 'You just started working on a task.',
      'agent_spotted': `You just noticed ${context.visibleAgents[0]?.name || 'someone'} nearby.`,
      'agent_lost_sight': 'Someone you were watching just left your view.',
      'entered_room': `You just entered ${context.currentZone || 'a new area'}.`,
      'idle_random': 'You have a moment to think.',
      'heard_speech': 'You heard someone talking nearby.',
      'passed_agent_closely': `You just passed close to ${context.visibleAgents.find((a: { name: string; distance: number }) => a.distance < 50)?.name || 'someone'}.`,
      'task_in_action_radius': 'A task location is nearby.'
    };

    return `${triggerDescriptions[trigger]}
Location: ${context.currentZone || 'Hallway'}
Tasks done: ${context.assignedTasks.filter((t: TaskAssignment) => t.isCompleted).length}/${context.assignedTasks.length}
Visible agents: ${context.visibleAgents.map((a: { name: string }) => a.name).join(', ') || 'None'}

What are you thinking? (One brief internal thought, stay in character)`;
  }

  /**
   * Should this agent speak given the trigger?
   */
  private shouldSpeak(trigger: ThoughtTrigger, context: AIContext): boolean {
    // Only speak on social triggers with low probability
    const socialTriggers: ThoughtTrigger[] = ['agent_spotted', 'passed_agent_closely', 'heard_speech'];
    if (socialTriggers.includes(trigger)) {
      return Math.random() < 0.15; // 15% chance on social triggers
    }
    // Very low chance on other triggers
    return Math.random() < 0.02; // 2% chance
  }

  /**
   * Random interval for idle thoughts
   */
  private randomInterval(): number {
    const [min, max] = this.config.randomThoughtIntervalMs;
    return min + Math.random() * (max - min);
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
    const fallbacks: Record<ThoughtTrigger, string[]> = {
      'arrived_at_destination': ['Here we go.', 'Made it.', 'Time to get to work.'],
      'task_completed': ['One down.', 'Task done!', 'That\'s progress.'],
      'task_started': ['Let me focus on this.', 'Okay, let\'s do this.'],
      'agent_spotted': ['Oh, someone\'s here.', 'Not alone...', 'Company.'],
      'agent_lost_sight': ['Where did they go?', 'They left.', 'Gone.'],
      'entered_room': [`${context.currentZone || 'New area'}...`, 'Different scenery.'],
      'idle_random': ['Hmm...', 'What next?', 'Thinking...', 'Stay focused.'],
      'heard_speech': ['What was that?', 'Someone said something.'],
      'passed_agent_closely': ['Hey there.', 'Passing by.', 'Excuse me.'],
      'task_in_action_radius': ['Task nearby.', 'Could work on this.']
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
      state.nextRandomThoughtTime = Date.now() + this.config.thoughtCooldownMs;
    }
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
