/**
 * LLM Request Queue
 * Serializes LLM requests to prevent overwhelming the GPU
 * Tracks queue statistics for monitoring
 */

import type { LLMQueueStats } from '@shared/types/protocol.types.ts';

// Re-export for convenience
export type { LLMQueueStats };

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
  
  // Singleton
  private static instance: LLMQueue | null = null;

  constructor(timeoutMs = 1000) {
    this.timeoutMs = timeoutMs;
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
    const request = this.queue.shift()!;
    const startTime = Date.now();
    
    try {
      // Create a timeout race
      const result = await Promise.race([
        request.execute(),
        this.createTimeout(request.id),
      ]);
      
      const durationMs = Date.now() - startTime;
      this.recordProcessing(durationMs, true, false);
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
  private recordProcessing(durationMs: number, success: boolean, timedOut: boolean): void {
    const now = Date.now();
    this.processingHistory.push({
      timestamp: now,
      durationMs,
      success,
      timedOut,
    });
    
    // Keep only last 5 minutes of history
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    this.processingHistory = this.processingHistory.filter(r => r.timestamp > fiveMinutesAgo);
  }

  /**
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
   * Get current queue statistics
   */
  getStats(): LLMQueueStats {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    return {
      queueDepth: this.queue.length,
      processingCount: this.isProcessing ? 1 : 0,
      totalProcessed: this.totalProcessed,
      totalTimedOut: this.totalTimedOut,
      totalFailed: this.totalFailed,
      avgProcessingTimeMs1Min: Math.round(this.calculateAvgProcessingTime(60 * 1000)),
      avgProcessingTimeMs5Min: Math.round(this.calculateAvgProcessingTime(5 * 60 * 1000)),
      processedPerSecond1Min: Math.round(this.calculateProcessedPerSecond(60 * 1000) * 100) / 100,
      processedPerSecond5Min: Math.round(this.calculateProcessedPerSecond(5 * 60 * 1000) * 100) / 100,
      recentRequests: this.processingHistory
        .filter(r => r.timestamp > oneMinuteAgo)
        .slice(-20) // Last 20 requests in the last minute
        .map(r => ({
          timestamp: r.timestamp,
          durationMs: r.durationMs,
          success: r.success,
          timedOut: r.timedOut,
        })),
    };
  }  /**
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
