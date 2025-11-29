/**
 * Rolling File Transport for Server-Side Logging
 * 
 * This module provides a file-based logging transport with:
 * - Rolling log files (configurable number of files to keep)
 * - JSON-formatted log entries
 * - Automatic file rotation based on size
 * - Buffered writes for performance
 * 
 * NOTE: This module is SERVER-SIDE ONLY and uses Node.js fs module
 */

import { LogLevel } from '../LogLevel.ts';
import type { LogEntry, LogTransport } from '../types.ts';

export interface FileTransportOptions {
  /** Directory to store log files */
  logDir: string;
  /** Base filename for logs (e.g., 'app' -> app.log, app.1.log, etc.) */
  baseFilename?: string;
  /** Maximum size of each log file in bytes (default: 10MB) */
  maxFileSize?: number;
  /** Maximum number of log files to keep (default: 20) */
  maxFiles?: number;
  /** Minimum log level for this transport */
  minLevel?: LogLevel;
  /** Buffer size before flushing (default: 100 entries) */
  bufferSize?: number;
  /** Flush interval in milliseconds (default: 5000) */
  flushIntervalMs?: number;
}

/**
 * Rolling File Transport - JSON-formatted rolling log files
 * 
 * Creates log files in the format:
 * - app.log (current)
 * - app.1.log (previous)
 * - app.2.log (older)
 * ... up to maxFiles
 */
export class FileTransport implements LogTransport {
  name = 'file';
  minLevel: LogLevel;
  
  private options: Required<FileTransportOptions>;
  private buffer: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private currentFileSize = 0;
  private fs: typeof import('fs') | null = null;
  private path: typeof import('path') | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: FileTransportOptions) {
    this.minLevel = options.minLevel ?? LogLevel.DEBUG;
    
    this.options = {
      logDir: options.logDir,
      baseFilename: options.baseFilename ?? 'app',
      maxFileSize: options.maxFileSize ?? 1024 * 1024 * 1024, // 1GB
      maxFiles: options.maxFiles ?? 1,
      minLevel: this.minLevel,
      bufferSize: options.bufferSize ?? 100,
      flushIntervalMs: options.flushIntervalMs ?? 5000,
    };
  }

  /**
   * Initialize the transport (lazy load fs/path modules)
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // Dynamic import for Node.js modules
        this.fs = await import('fs');
        this.path = await import('path');
        
        // Ensure log directory exists
        await this.fs.promises.mkdir(this.options.logDir, { recursive: true });
        
        // Get current file size
        const currentPath = this.getCurrentFilePath();
        try {
          const stats = await this.fs.promises.stat(currentPath);
          this.currentFileSize = stats.size;
        } catch {
          // File doesn't exist yet, that's fine
          this.currentFileSize = 0;
        }
        
        // Start flush timer
        this.startFlushTimer();
        
        this.initialized = true;
      } catch (error) {
        console.error('[FileTransport] Failed to initialize:', error);
        throw error;
      }
    })();

    return this.initPromise;
  }

  private getCurrentFilePath(): string {
    return this.path!.join(this.options.logDir, `${this.options.baseFilename}.log`);
  }

  private getRotatedFilePath(index: number): string {
    return this.path!.join(this.options.logDir, `${this.options.baseFilename}.${index}.log`);
  }

  /**
   * Write a log entry (buffered)
   */
  write(entry: LogEntry): void {
    // Ensure initialization starts
    if (!this.initialized && !this.initPromise) {
      this.initialize().catch(console.error);
    }

    this.buffer.push(entry);
    
    if (this.buffer.length >= this.options.bufferSize) {
      this.flush().catch(console.error);
    }
  }

  /**
   * Flush the buffer to disk
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    
    // Wait for initialization
    await this.initialize();
    
    if (!this.fs) {
      console.error('[FileTransport] fs module not available');
      return;
    }

    const entries = this.buffer.splice(0, this.buffer.length);
    const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    const bytesToWrite = Buffer.byteLength(lines, 'utf8');

    // Check if we need to rotate
    if (this.currentFileSize + bytesToWrite > this.options.maxFileSize) {
      await this.rotate();
    }

    // Append to current file
    try {
      await this.fs.promises.appendFile(this.getCurrentFilePath(), lines, 'utf8');
      this.currentFileSize += bytesToWrite;
    } catch (error) {
      console.error('[FileTransport] Failed to write to log file:', error);
      // Put entries back in buffer for retry
      this.buffer.unshift(...entries);
    }
  }

  /**
   * Rotate log files
   */
  private async rotate(): Promise<void> {
    if (!this.fs || !this.path) return;

    try {
      // Delete the oldest file if it exists
      const oldestPath = this.getRotatedFilePath(this.options.maxFiles - 1);
      try {
        await this.fs.promises.unlink(oldestPath);
      } catch {
        // File doesn't exist, that's fine
      }

      // Shift all existing files up by one
      for (let i = this.options.maxFiles - 2; i >= 1; i--) {
        const fromPath = this.getRotatedFilePath(i);
        const toPath = this.getRotatedFilePath(i + 1);
        try {
          await this.fs.promises.rename(fromPath, toPath);
        } catch {
          // File doesn't exist, that's fine
        }
      }

      // Move current file to .1
      const currentPath = this.getCurrentFilePath();
      const firstRotatedPath = this.getRotatedFilePath(1);
      try {
        await this.fs.promises.rename(currentPath, firstRotatedPath);
      } catch {
        // Current file doesn't exist, that's fine
      }

      this.currentFileSize = 0;
    } catch (error) {
      console.error('[FileTransport] Failed to rotate log files:', error);
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    
    this.flushTimer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.options.flushIntervalMs);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Close the transport
   */
  async close(): Promise<void> {
    this.stopFlushTimer();
    await this.flush();
  }
}

/**
 * Create a file transport with common defaults
 */
export function createFileTransport(logDir: string, options?: Partial<FileTransportOptions>): FileTransport {
  return new FileTransport({
    logDir,
    ...options,
  });
}
