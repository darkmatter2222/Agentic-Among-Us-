/**
 * LLM Request Queue
 * Serializes LLM requests to prevent overwhelming the GPU
 * Tracks queue statistics for monitoring
 * Provides capacity-aware thinking coefficient for agent AI
 */

import type { LLMQueueStats, LLMCapacityConfig } from '@shared/types/protocol.types.ts';

// Re-export for convenience
export type { LLMQueueStats, LLMCapacityConfig };

// Default capacity configuration
const DEFAULT_CAPACITY_CONFIG: LLMCapacityConfig = {
  maxTokensPerSecond: 2000,     // Model ceiling - high capacity for lots of agent thinking
  minThinkingCoefficient: 0.2,  // Never go below 20% thinking
  maxThinkingCoefficient: 2.0,  // Can boost to 200% when capacity is available (more headroom!)
  targetUtilization: 0.7,       // Target 70% utilization for headroom
};

interface QueuedRequest<T> {
  id: number;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

interface ProcessingRecord {
  timestamp: number;
  durationMs: number;
  success: boolean;
  timedOut: boolean;
  promptTokens?: number;
  completionTokens?: number;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export class LLMQueue {
  private queue: QueuedRequest<unknown>[] = [];
  private isProcessing = false;
  private requestIdCounter = 0;
  private timeoutMs: number;

  // Statistics tracking
  private processingHistory: ProcessingRecord[] = [];
  private totalProcessed = 0;
  private totalTimedOut = 0;
  private totalFailed = 0;
  private totalPromptTokens = 0;
  private totalCompletionTokens = 0;

  // Pending token info for current request
  private pendingTokens: TokenUsage | null = null;

  // Capacity configuration
  private capacityConfig: LLMCapacityConfig;

  // Current stats interval (in ms) - default 60 seconds
  private statsIntervalMs: number = 60 * 1000;

  /**
   * Record token usage from the current LLM request
   * Call this from within your execute function after getting the LLM response
   */
  recordTokenUsage(promptTokens: number, completionTokens: number): void {
    this.pendingTokens = { promptTokens, completionTokens };
  }

  private getPendingTokens(): TokenUsage | null {
    return this.pendingTokens;
  }

  private clearPendingTokens(): void {
    this.pendingTokens = null;
  }

  // Singleton
  private static instance: LLMQueue | null = null;

  constructor(timeoutMs = 1000, capacityConfig?: Partial<LLMCapacityConfig>) {
    this.timeoutMs = timeoutMs;
    this.capacityConfig = { ...DEFAULT_CAPACITY_CONFIG, ...capacityConfig };
  }

  static getInstance(timeoutMs = 1000): LLMQueue {
    if (!LLMQueue.instance) {
      LLMQueue.instance = new LLMQueue(timeoutMs);
    }
    return LLMQueue.instance;
  }

  static resetInstance(): void {
    LLMQueue.instance = null;
  }

  /**
   * Update capacity configuration
   */
  setCapacityConfig(config: Partial<LLMCapacityConfig>): void {
    this.capacityConfig = { ...this.capacityConfig, ...config };
  }

  /**
   * Get current capacity configuration
   */
  getCapacityConfig(): LLMCapacityConfig {
    return { ...this.capacityConfig };
  }

  /**
   * Set the stats time interval (in milliseconds)
   */
  setStatsInterval(intervalMs: number): void {
    this.statsIntervalMs = Math.max(10000, Math.min(300000, intervalMs)); // Clamp between 10s and 5min
  }

  /**
   * Get current stats interval
   */
  getStatsInterval(): number {
    return this.statsIntervalMs;
  }

  /**
   * Add a request to the queue
   * Returns a promise that resolves when the request completes
   */
  enqueue<T>(execute: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id: ++this.requestIdCounter,
        execute,
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueuedAt: Date.now(),
      };
      
      this.queue.push(request as QueuedRequest<unknown>);
      this.processNext();
    });
  }

  /**
   * Process the next request in the queue
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    this.pendingTokens = null; // Reset pending tokens
    const request = this.queue.shift()!;
    const startTime = Date.now();

    try {
      // Create a timeout race
      const result = await Promise.race([
        request.execute(),
        this.createTimeout(request.id),
      ]);

      const durationMs = Date.now() - startTime;
      const tokenInfo = this.getPendingTokens();
      this.clearPendingTokens();
      this.recordProcessing(durationMs, true, false, tokenInfo?.promptTokens, tokenInfo?.completionTokens);
      this.totalProcessed++;

      request.resolve(result);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const isTimeout = error instanceof Error && error.message.includes('LLM request timed out');

      if (isTimeout) {
        this.totalTimedOut++;
        this.recordProcessing(durationMs, false, true);
      } else {
        this.totalFailed++;
        this.recordProcessing(durationMs, false, false);
      }
      
      request.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.isProcessing = false;
      // Process next request if any
      if (this.queue.length > 0) {
        // Use setImmediate to prevent stack overflow on long queues
        setImmediate(() => this.processNext());
      }
    }
  }

  /**
   * Create a timeout promise
   */
  private createTimeout(requestId: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`LLM request ${requestId} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });
  }

  /**
   * Record processing statistics
   */
  private recordProcessing(durationMs: number, success: boolean, timedOut: boolean, promptTokens?: number, completionTokens?: number): void {
    const now = Date.now();
    this.processingHistory.push({
      timestamp: now,
      durationMs,
      success,
      timedOut,
      promptTokens,
      completionTokens,
    });

    // Track total tokens
    if (promptTokens) this.totalPromptTokens += promptTokens;
    if (completionTokens) this.totalCompletionTokens += completionTokens;

    // Keep only last 5 minutes of history
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    this.processingHistory = this.processingHistory.filter(r => r.timestamp > fiveMinutesAgo);
  }  /**
   * Calculate average processing time for a time window
   */
  private calculateAvgProcessingTime(windowMs: number): number {
    const now = Date.now();
    const cutoff = now - windowMs;
    const recentRecords = this.processingHistory.filter(r => r.timestamp > cutoff && r.success);

    if (recentRecords.length === 0) {
      return 0;
    }

    const totalMs = recentRecords.reduce((sum, r) => sum + r.durationMs, 0);
    return totalMs / recentRecords.length;
  }

  /**
   * Calculate processed per second for a time window
   */
  private calculateProcessedPerSecond(windowMs: number): number {
    const now = Date.now();
    const cutoff = now - windowMs;
    const recentRecords = this.processingHistory.filter(r => r.timestamp > cutoff && r.success);
    const windowSeconds = windowMs / 1000;
    return recentRecords.length / windowSeconds;
  }

  /**
   * Calculate tokens per second for a time window (prompt, completion, or total)
   */
  private calculateTokensPerSecond(windowMs: number, type: 'prompt' | 'completion' | 'total'): number {
    const now = Date.now();
    const cutoff = now - windowMs;
    const recentRecords = this.processingHistory.filter(r => r.timestamp > cutoff && r.success);
    const windowSeconds = windowMs / 1000;
    
    let totalTokens = 0;
    for (const r of recentRecords) {
      if (type === 'prompt') {
        totalTokens += r.promptTokens || 0;
      } else if (type === 'completion') {
        totalTokens += r.completionTokens || 0;
      } else {
        totalTokens += (r.promptTokens || 0) + (r.completionTokens || 0);
      }
    }
    
    return totalTokens / windowSeconds;
  }

  /**
   * Calculate average tokens per request for a time window
   */
  private calculateAvgTokens(windowMs: number, type: 'prompt' | 'completion'): number {
    const now = Date.now();
    const cutoff = now - windowMs;
    const recentRecords = this.processingHistory.filter(r => r.timestamp > cutoff && r.success);
    if (recentRecords.length === 0) return 0;
    const total = recentRecords.reduce((sum, r) =>
      sum + (type === 'prompt' ? (r.promptTokens || 0) : (r.completionTokens || 0)), 0);
    return total / recentRecords.length;
  }

  /**
   * Calculate current capacity utilization (0-1)
   * Based on total tokens per second vs max capacity
   */
  private calculateCapacityUtilization(): number {
    const totalTokensPerSec = this.calculateTokensPerSecond(this.statsIntervalMs, 'total');
    return Math.min(1, totalTokensPerSec / this.capacityConfig.maxTokensPerSecond);
  }

  /**
   * Calculate the thinking coefficient (0-maxCoefficient)
   * Higher = agents can think more frequently
   * Lower = agents should throttle thinking
   */
  calculateThinkingCoefficient(): number {
    const utilization = this.calculateCapacityUtilization();
    const queuePressure = Math.min(1, this.queue.length / 10); // Queue pressure factor
    
    // Combined load factor
    const loadFactor = Math.max(utilization, queuePressure);
    
    const { minThinkingCoefficient, maxThinkingCoefficient, targetUtilization } = this.capacityConfig;
    
    if (loadFactor < targetUtilization * 0.5) {
      // Very low load - boost thinking
      return maxThinkingCoefficient;
    } else if (loadFactor < targetUtilization) {
      // Below target - scale up linearly
      const range = maxThinkingCoefficient - 1.0;
      const scale = 1 - (loadFactor / targetUtilization);
      return 1.0 + (range * scale);
    } else if (loadFactor < 0.9) {
      // Above target but not critical - scale down linearly from 1.0 to min
      const range = 1.0 - minThinkingCoefficient;
      const scale = (loadFactor - targetUtilization) / (0.9 - targetUtilization);
      return 1.0 - (range * scale);
    } else {
      // High load - minimum thinking
      return minThinkingCoefficient;
    }
  }

  /**
   * Get current queue statistics
   */
  getStats(): LLMQueueStats {
    const now = Date.now();
    const windowMs = this.statsIntervalMs;
    const cutoff = now - windowMs;

    const tokensPerSecIn = this.calculateTokensPerSecond(windowMs, 'prompt');
    const tokensPerSecOut = this.calculateTokensPerSecond(windowMs, 'completion');
    const tokensPerSecTotal = this.calculateTokensPerSecond(windowMs, 'total');
    
    const capacityUtilization = this.calculateCapacityUtilization();
    const thinkingCoefficient = this.calculateThinkingCoefficient();
    const availableCapacity = Math.max(0, this.capacityConfig.maxTokensPerSecond - tokensPerSecTotal);

    return {
      // Queue state
      queueDepth: this.queue.length,
      processingCount: this.isProcessing ? 1 : 0,
      
      // Totals
      totalProcessed: this.totalProcessed,
      totalTimedOut: this.totalTimedOut,
      totalFailed: this.totalFailed,
      
      // Performance metrics
      avgProcessingTimeMs: Math.round(this.calculateAvgProcessingTime(windowMs)),
      processedPerSecond: Math.round(this.calculateProcessedPerSecond(windowMs) * 100) / 100,
      
      // Token throughput
      tokensPerSecondIn: Math.round(tokensPerSecIn * 10) / 10,
      tokensPerSecondOut: Math.round(tokensPerSecOut * 10) / 10,
      tokensPerSecondTotal: Math.round(tokensPerSecTotal * 10) / 10,
      tokensPerMinuteIn: Math.round(tokensPerSecIn * 60),
      tokensPerMinuteOut: Math.round(tokensPerSecOut * 60),
      tokensPerMinuteTotal: Math.round(tokensPerSecTotal * 60),
      
      // Average tokens per request
      avgTokensIn: Math.round(this.calculateAvgTokens(windowMs, 'prompt')),
      avgTokensOut: Math.round(this.calculateAvgTokens(windowMs, 'completion')),
      
      // Lifetime totals
      totalPromptTokens: this.totalPromptTokens,
      totalCompletionTokens: this.totalCompletionTokens,
      
      // Capacity metrics
      capacityConfig: { ...this.capacityConfig },
      capacityUtilization: Math.round(capacityUtilization * 1000) / 1000,
      thinkingCoefficient: Math.round(thinkingCoefficient * 100) / 100,
      availableCapacity: Math.round(availableCapacity),
      
      // Recent requests
      recentRequests: this.processingHistory
        .filter(r => r.timestamp > cutoff)
        .slice(-20) // Last 20 requests
        .map(r => ({
          timestamp: r.timestamp,
          durationMs: r.durationMs,
          success: r.success,
          timedOut: r.timedOut,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
        })),
    };
  }/**
   * Get queue depth
   */
  getQueueDepth(): number {
    return this.queue.length;
  }

  /**
   * Check if currently processing
   */
  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }

  /**
   * Update timeout setting
   */
  setTimeout(timeoutMs: number): void {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Get current timeout setting
   */
  getTimeout(): number {
    return this.timeoutMs;
  }

  /**
   * Clear the queue (for shutdown)
   */
  clear(): void {
    // Reject all pending requests
    for (const request of this.queue) {
      request.reject(new Error('Queue cleared'));
    }
    this.queue = [];
  }
}

// Export singleton getter
export function getLLMQueue(timeoutMs = 1000): LLMQueue {
  return LLMQueue.getInstance(timeoutMs);
}

export function resetLLMQueue(): void {
  LLMQueue.resetInstance();
}
