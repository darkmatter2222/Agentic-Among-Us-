/**
 * Custom AI model client for Among Us agents
 * Adapted from llama.cpp pattern for React/TypeScript
 * Connects to llama.cpp server at http://192.168.86.48:8080
 */

import { aiLogger } from '../logging/index.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  top_k?: number;
  repeat_penalty?: number;
}

export interface ChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: Array<{
    index?: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface AIModelOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
}

export class AIModelClient {
  private baseUrl: string;
  private timeout: number;
  private defaultOptions: AIModelOptions;

  constructor(
    baseUrl: string = 'http://192.168.86.48:8080',
    timeout: number = 60000,
    defaultOptions: AIModelOptions = {}
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = timeout;
    this.defaultOptions = {
      temperature: 0.7,
      maxTokens: 300,
      topP: 0.9,
      topK: 40,
      repeatPenalty: 1.1,
      ...defaultOptions
    };
  }

  /**
   * Get chat completion from AI model
   */
  async getChatCompletion(
    messages: ChatMessage[],
    options?: AIModelOptions
  ): Promise<string> {
    // Filter out consecutive assistant messages (llama.cpp doesn't allow this)
    const filteredMessages = this.filterConsecutiveAssistantMessages(messages);

    const mergedOptions = { ...this.defaultOptions, ...options };

    const payload: ChatCompletionRequest = {
      messages: filteredMessages,
      temperature: mergedOptions.temperature,
      max_tokens: mergedOptions.maxTokens,
      stream: false,
      top_p: mergedOptions.topP,
      top_k: mergedOptions.topK,
      repeat_penalty: mergedOptions.repeatPenalty
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `AI Model API error (${response.status}): ${errorText}`
        );
      }

      const result: ChatCompletionResponse = await response.json();
      
      if (!result.choices || result.choices.length === 0) {
        throw new Error('AI Model returned no choices');
      }

      return result.choices[0].message.content;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`AI Model request timed out after ${this.timeout}ms`);
        }
        aiLogger.error('AI Model API Error', { error });
        throw error;
      }
      throw new Error('Unknown error communicating with AI model');
    }
  }

  /**
   * Filter consecutive assistant messages
   * llama.cpp doesn't allow assistant messages back-to-back
   */
  private filterConsecutiveAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
    const filtered: ChatMessage[] = [];
    let lastRole: string | null = null;

    for (const message of messages) {
      // Skip consecutive assistant messages
      if (message.role === 'assistant' && lastRole === 'assistant') {
        continue;
      }

      filtered.push(message);
      lastRole = message.role;
    }

    // Ensure we don't end with multiple assistant messages
    if (
      filtered.length >= 2 &&
      filtered[filtered.length - 1].role === 'assistant' &&
      filtered[filtered.length - 2].role === 'assistant'
    ) {
      filtered.splice(-2, 1);
    }

    return filtered;
  }

  /**
   * Simplified decision-making interface
   * System prompt + user context = decision
   */
  async getDecision(
    systemPrompt: string,
    context: string,
    options?: AIModelOptions
  ): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: context }
    ];

    return this.getChatCompletion(messages, options);
  }

  /**
   * Multi-turn conversation support
   */
  async continueConversation(
    conversationHistory: ChatMessage[],
    newMessage: string,
    options?: AIModelOptions
  ): Promise<string> {
    const messages = [
      ...conversationHistory,
      { role: 'user' as const, content: newMessage }
    ];

    return this.getChatCompletion(messages, options);
  }

  /**
   * Test connection to AI model
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.getDecision(
        'You are a helpful assistant.',
        'Say "OK" if you can read this.',
        { temperature: 0.1, maxTokens: 10 }
      );
      return response.toLowerCase().includes('ok');
    } catch (error) {
      aiLogger.error('AI Model connection test failed', { error });
      return false;
    }
  }

  /**
   * Get base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Update base URL
   */
  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
  }

  /**
   * Get timeout
   */
  getTimeout(): number {
    return this.timeout;
  }

  /**
   * Update timeout
   */
  setTimeout(timeout: number): void {
    this.timeout = timeout;
  }
}

// Singleton instance for global use
export const aiClient = new AIModelClient();

// Helper functions for common AI tasks in Among Us

/**
 * Ask AI to prioritize tasks
 */
export async function getTaskPriority(
  availableTasks: string[],
  currentLocation: string,
  dangerLevel: number,
  options?: AIModelOptions
): Promise<string> {
  const systemPrompt = `You are a Crewmate in Among Us. You need to complete tasks to win.
Prioritize tasks based on: safety, proximity, and strategic value.
Return only the task name you should do next.`;

  const context = `Available tasks: ${availableTasks.join(', ')}
Current location: ${currentLocation}
Danger level: ${dangerLevel}/100

Which task should I do next?`;

  return aiClient.getDecision(systemPrompt, context, {
    temperature: 0.7,
    maxTokens: 50,
    ...options
  });
}

/**
 * Ask AI to decide who to vote for
 */
export async function getVoteDecision(
  suspects: string[],
  evidence: Record<string, string[]>,
  options?: AIModelOptions
): Promise<string> {
  const systemPrompt = `You are playing Among Us. Analyze evidence and decide who to vote for.
Consider: alibis, suspicious behavior, witness testimony, and logical consistency.
Return only the player name or "SKIP".`;

  const evidenceText = Object.entries(evidence)
    .map(([player, facts]) => `${player}: ${facts.join('; ')}`)
    .join('\n');

  const context = `Suspects: ${suspects.join(', ')}

Evidence:
${evidenceText}

Who should I vote for?`;

  return aiClient.getDecision(systemPrompt, context, {
    temperature: 0.8,
    maxTokens: 50,
    ...options
  });
}

/**
 * Ask AI impostor when to kill
 */
export async function getKillDecision(
  nearbyPlayers: string[],
  witnessRisk: number,
  escapeRoutes: number,
  killCooldown: number,
  options?: AIModelOptions
): Promise<{ shouldKill: boolean; target?: string; reasoning: string }> {
  const systemPrompt = `You are an Impostor in Among Us. Decide whether to kill now.
Consider: witness risk, escape routes, kill cooldown, and overall strategy.
Respond in JSON format: {"shouldKill": boolean, "target": "player name" or null, "reasoning": "brief explanation"}`;

  const context = `Nearby players: ${nearbyPlayers.join(', ')}
Witness risk: ${witnessRisk}/100
Escape routes available: ${escapeRoutes}
Kill cooldown: ${killCooldown}s

Should I kill someone right now?`;

  const response = await aiClient.getDecision(systemPrompt, context, {
    temperature: 0.9,
    maxTokens: 150,
    ...options
  });

  try {
    return JSON.parse(response);
  } catch {
    // Fallback if JSON parsing fails
    return {
      shouldKill: false,
      reasoning: 'Failed to parse AI response'
    };
  }
}

/**
 * Generate meeting statement
 */
export async function generateMeetingStatement(
  role: 'crewmate' | 'impostor',
  observations: string[],
  suspicions: Record<string, number>,
  options?: AIModelOptions
): Promise<string> {
  const systemPrompt = `You are ${role === 'impostor' ? 'an Impostor' : 'a Crewmate'} in Among Us.
Generate a brief, natural statement for the meeting discussion.
${role === 'impostor' ? 'Be deceptive and deflect suspicion.' : 'Share relevant information and suspicions.'}
Keep it under 50 words.`;

  const suspicionText = Object.entries(suspicions)
    .filter(([_, level]) => level > 30)
    .map(([player, level]) => `${player} (${level}% suspicious)`)
    .join(', ');

  const context = `What I observed: ${observations.join('; ')}
${suspicionText ? `Suspicious players: ${suspicionText}` : 'No strong suspicions yet'}

What should I say in the meeting?`;

  return aiClient.getDecision(systemPrompt, context, {
    temperature: 0.9,
    maxTokens: 100,
    ...options
  });
}
