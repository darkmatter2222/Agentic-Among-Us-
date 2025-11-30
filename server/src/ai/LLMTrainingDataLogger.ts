/**
 * LLM Training Data Logger
 * 
 * Captures successful and failed LLM interactions for training data collection.
 * - Success: LLM returned valid, parseable response matching expected format
 * - Failure: LLM refused, returned unparseable response, or required fallback
 * 
 * Files are saved to: LLM-training-data/success/ and LLM-training-data/fail/
 * Each file contains up to 20MB of JSON entries before rotating to a new file.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { LLMTraceEvent } from '@shared/types/llm-trace.types.ts';
import { aiLogger } from '../logging/index.js';

// Configuration
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
// Go up from server/ to project root
const BASE_DIR = path.join(process.cwd(), '..', 'LLM-training-data');
const SUCCESS_DIR = path.join(BASE_DIR, 'success');
const FAIL_DIR = path.join(BASE_DIR, 'fail');

// File naming
const FILE_PREFIX = 'training-data-';
const FILE_EXTENSION = '.json';

/**
 * A single training data entry
 */
export interface TrainingDataEntry {
  id: string;
  timestamp: string;
  requestType: 'decision' | 'thought' | 'speech' | 'conversation';
  agentName: string;
  agentRole: 'CREWMATE' | 'IMPOSTOR';
  systemPrompt: string;
  userPrompt: string;
  rawResponse: string;
  success: boolean;
  durationMs: number;
  // Additional context that may be useful for training
  context: {
    zone?: string | null;
    visibleAgentCount?: number;
    taskProgress?: {
      completed: number;
      total: number;
    };
  };
}

/**
 * Manages logging of LLM training data to rotating JSON files
 */
class LLMTrainingDataLoggerImpl {
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  
  // Current file state for success logs
  private successFileIndex: number = 1;
  private successFileSize: number = 0;
  private successFileHandle: fs.FileHandle | null = null;
  private successEntryCount: number = 0;
  
  // Current file state for fail logs
  private failFileIndex: number = 1;
  private failFileSize: number = 0;
  private failFileHandle: fs.FileHandle | null = null;
  private failEntryCount: number = 0;
  
  // Write buffer for batching (improves performance)
  private successBuffer: TrainingDataEntry[] = [];
  private failBuffer: TrainingDataEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 2000; // Flush every 2 seconds
  private readonly MAX_BUFFER_SIZE = 5; // Or when buffer hits 5 entries

  /**
   * Initialize the logger - creates directories and finds the latest file index
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    await this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      // Create directories
      await fs.mkdir(SUCCESS_DIR, { recursive: true });
      await fs.mkdir(FAIL_DIR, { recursive: true });

      // Find the latest file index for success
      this.successFileIndex = await this.findLatestFileIndex(SUCCESS_DIR);
      const successPath = this.getFilePath(SUCCESS_DIR, this.successFileIndex);
      try {
        const stats = await fs.stat(successPath);
        this.successFileSize = stats.size;
      } catch {
        this.successFileSize = 0;
      }

      // Find the latest file index for fail
      this.failFileIndex = await this.findLatestFileIndex(FAIL_DIR);
      const failPath = this.getFilePath(FAIL_DIR, this.failFileIndex);
      try {
        const stats = await fs.stat(failPath);
        this.failFileSize = stats.size;
      } catch {
        this.failFileSize = 0;
      }

      // Start periodic flush
      this.flushInterval = setInterval(() => {
        this.flushBuffers().catch(err => {
          aiLogger.error('Error flushing LLM training data buffers', { error: err as Error });
        });
      }, this.FLUSH_INTERVAL_MS);

      this.initialized = true;
      aiLogger.info('LLM Training Data Logger initialized', {
        successDir: SUCCESS_DIR,
        failDir: FAIL_DIR,
        successFileIndex: this.successFileIndex,
        failFileIndex: this.failFileIndex
      });
    } catch (error) {
      aiLogger.error('Failed to initialize LLM Training Data Logger', { error: error as Error });
      throw error;
    }
  }

  /**
   * Find the highest file index in a directory
   */
  private async findLatestFileIndex(dir: string): Promise<number> {
    try {
      const files = await fs.readdir(dir);
      let maxIndex = 0;

      for (const file of files) {
        if (file.startsWith(FILE_PREFIX) && file.endsWith(FILE_EXTENSION)) {
          const indexStr = file.slice(FILE_PREFIX.length, -FILE_EXTENSION.length);
          const index = parseInt(indexStr, 10);
          if (!isNaN(index) && index > maxIndex) {
            maxIndex = index;
          }
        }
      }

      // Return at least 1 (first file)
      return Math.max(1, maxIndex);
    } catch {
      return 1;
    }
  }

  /**
   * Get the file path for a given directory and index
   */
  private getFilePath(dir: string, index: number): string {
    return path.join(dir, `${FILE_PREFIX}${index}${FILE_EXTENSION}`);
  }

  /**
   * Log a training data entry from an LLM trace event
   */
  async logTraceEvent(trace: LLMTraceEvent): Promise<void> {
    await this.initialize();

    aiLogger.debug('LLM Training Data: logging trace event', {
      id: trace.id,
      success: trace.success,
      successBufferSize: this.successBuffer.length,
      failBufferSize: this.failBuffer.length
    });

    const entry: TrainingDataEntry = {
      id: trace.id,
      timestamp: new Date(trace.timestamp).toISOString(),
      requestType: trace.requestType,
      agentName: trace.agentName,
      agentRole: trace.agentRole,
      systemPrompt: trace.systemPrompt,
      userPrompt: trace.userPrompt,
      rawResponse: trace.rawResponse,
      success: trace.success,
      durationMs: trace.durationMs,
      context: {
        zone: trace.context?.zone,
        visibleAgentCount: trace.context?.visibleAgents?.length ?? 0,
        taskProgress: trace.context?.taskProgress
      }
    };

    if (trace.success) {
      this.successBuffer.push(entry);
      if (this.successBuffer.length >= this.MAX_BUFFER_SIZE) {
        await this.flushSuccessBuffer();
      }
    } else {
      this.failBuffer.push(entry);
      if (this.failBuffer.length >= this.MAX_BUFFER_SIZE) {
        await this.flushFailBuffer();
      }
    }
  }

  /**
   * Flush both buffers
   */
  private async flushBuffers(): Promise<void> {
    await Promise.all([
      this.flushSuccessBuffer(),
      this.flushFailBuffer()
    ]);
  }

  /**
   * Flush success buffer to file
   */
  private async flushSuccessBuffer(): Promise<void> {
    if (this.successBuffer.length === 0) return;

    aiLogger.info('LLM Training Data: flushing success buffer', {
      entryCount: this.successBuffer.length,
      fileIndex: this.successFileIndex
    });

    const entries = this.successBuffer;
    this.successBuffer = [];

    try {
      await this.writeEntries(
        SUCCESS_DIR,
        entries,
        () => this.successFileIndex,
        (idx) => { this.successFileIndex = idx; },
        () => this.successFileSize,
        (size) => { this.successFileSize = size; },
        () => this.successEntryCount,
        (count) => { this.successEntryCount = count; }
      );
    } catch (error) {
      // Re-add entries to buffer on failure (best effort)
      this.successBuffer = [...entries, ...this.successBuffer];
      aiLogger.error('Failed to flush success buffer', { error: error as Error });
    }
  }

  /**
   * Flush fail buffer to file
   */
  private async flushFailBuffer(): Promise<void> {
    if (this.failBuffer.length === 0) return;

    const entries = this.failBuffer;
    this.failBuffer = [];

    try {
      await this.writeEntries(
        FAIL_DIR,
        entries,
        () => this.failFileIndex,
        (idx) => { this.failFileIndex = idx; },
        () => this.failFileSize,
        (size) => { this.failFileSize = size; },
        () => this.failEntryCount,
        (count) => { this.failEntryCount = count; }
      );
    } catch (error) {
      // Re-add entries to buffer on failure (best effort)
      this.failBuffer = [...entries, ...this.failBuffer];
      aiLogger.error('Failed to flush fail buffer', { error: error as Error });
    }
  }

  /**
   * Write entries to the appropriate file, handling rotation
   */
  private async writeEntries(
    dir: string,
    entries: TrainingDataEntry[],
    getFileIndex: () => number,
    setFileIndex: (idx: number) => void,
    getFileSize: () => number,
    setFileSize: (size: number) => void,
    getEntryCount: () => number,
    setEntryCount: (count: number) => void
  ): Promise<void> {
    for (const entry of entries) {
      // Serialize entry
      const entryJson = JSON.stringify(entry);
      const entryBytes = Buffer.byteLength(entryJson, 'utf8') + 2; // +2 for newline/comma

      // Check if we need to rotate
      if (getFileSize() + entryBytes > MAX_FILE_SIZE_BYTES && getFileSize() > 0) {
        // Close current file with proper JSON array ending
        await this.closeJsonArray(dir, getFileIndex());
        
        // Move to next file
        setFileIndex(getFileIndex() + 1);
        setFileSize(0);
        setEntryCount(0);
        
        aiLogger.info('Rotated LLM training data file', { 
          dir, 
          newIndex: getFileIndex() 
        });
      }

      // Write entry
      const filePath = this.getFilePath(dir, getFileIndex());
      const isFirstEntry = getEntryCount() === 0;

      aiLogger.info('LLM Training Data: writing entry to file', {
        filePath,
        isFirstEntry,
        entryCount: getEntryCount(),
        fileIndex: getFileIndex()
      });

      try {
        if (isFirstEntry) {
          // Start new JSON array
          await fs.writeFile(filePath, '[\n' + entryJson, 'utf8');
          setFileSize(Buffer.byteLength('[\n' + entryJson, 'utf8'));
          aiLogger.info('LLM Training Data: created new file', { filePath });
        } else {
          // Append to existing array
          await fs.appendFile(filePath, ',\n' + entryJson, 'utf8');
          setFileSize(getFileSize() + entryBytes);
        }
        setEntryCount(getEntryCount() + 1);
      } catch (error) {
        aiLogger.error('Failed to write training data entry', { 
          error: error as Error, 
          filePath 
        });
        throw error;
      }
    }
  }

  /**
   * Close a JSON array file properly
   */
  private async closeJsonArray(dir: string, fileIndex: number): Promise<void> {
    const filePath = this.getFilePath(dir, fileIndex);
    try {
      await fs.appendFile(filePath, '\n]', 'utf8');
    } catch (error) {
      aiLogger.warn('Failed to close JSON array', { filePath, error: error as Error });
    }
  }

  /**
   * Graceful shutdown - flush buffers and close files
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush
    await this.flushBuffers();

    // Close JSON arrays if they have entries
    if (this.successEntryCount > 0) {
      await this.closeJsonArray(SUCCESS_DIR, this.successFileIndex);
    }
    if (this.failEntryCount > 0) {
      await this.closeJsonArray(FAIL_DIR, this.failFileIndex);
    }

    aiLogger.info('LLM Training Data Logger shutdown complete', {
      successEntries: this.successEntryCount,
      failEntries: this.failEntryCount
    });
  }

  /**
   * Get current statistics
   */
  getStats(): {
    successFileIndex: number;
    successFileSize: number;
    successBufferSize: number;
    failFileIndex: number;
    failFileSize: number;
    failBufferSize: number;
  } {
    return {
      successFileIndex: this.successFileIndex,
      successFileSize: this.successFileSize,
      successBufferSize: this.successBuffer.length,
      failFileIndex: this.failFileIndex,
      failFileSize: this.failFileSize,
      failBufferSize: this.failBuffer.length
    };
  }
}

// Singleton instance
let instance: LLMTrainingDataLoggerImpl | null = null;

/**
 * Get the singleton LLM Training Data Logger instance
 */
export function getLLMTrainingDataLogger(): LLMTrainingDataLoggerImpl {
  if (!instance) {
    instance = new LLMTrainingDataLoggerImpl();
  }
  return instance;
}

/**
 * Convenience function to log a trace event
 */
export async function logLLMTrainingData(trace: LLMTraceEvent): Promise<void> {
  return getLLMTrainingDataLogger().logTraceEvent(trace);
}

/**
 * Shutdown the logger gracefully
 */
export async function shutdownLLMTrainingDataLogger(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}
