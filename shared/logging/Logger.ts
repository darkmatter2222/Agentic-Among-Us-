import { LogLevel, LOG_LEVEL_NAMES } from './LogLevel.ts';
import type { LogCategory, LogContext, LogEntry, LogTransport, LoggerConfig } from './types.ts';

/**
 * Universal Logger - The core logging engine for Agentic Among Us
 * 
 * Features:
 * - Multiple log levels (TRACE, DEBUG, INFO, WARN, ERROR, FATAL)
 * - Structured JSON output
 * - Category/namespace support
 * - Context enrichment (agentId, tick, zone, etc.)
 * - Multiple transports (console, file, etc.)
 * - Child loggers with inherited config
 */
export class Logger {
  private config: LoggerConfig;
  private childContext: LogContext;

  constructor(config: LoggerConfig, childContext: LogContext = {}) {
    this.config = config;
    this.childContext = childContext;
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): Logger {
    return new Logger(this.config, {
      ...this.childContext,
      ...context,
    });
  }

  /**
   * Create a child logger for a specific category
   */
  forCategory(category: LogCategory): Logger {
    return this.child({ category });
  }

  /**
   * Create a child logger for a specific agent
   */
  forAgent(agentId: string, agentName?: string): Logger {
    return this.child({ agentId, agentName });
  }

  /**
   * Set the current tick (useful for simulation context)
   */
  withTick(tick: number): Logger {
    return this.child({ tick });
  }

  /**
   * Check if a log level is enabled
   */
  isLevelEnabled(level: LogLevel): boolean {
    return level >= this.config.minLevel;
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.isLevelEnabled(level)) return;

    const now = new Date();
    const entry: LogEntry = {
      timestamp: now.toISOString(),
      epochMs: now.getTime(),
      level,
      levelName: LOG_LEVEL_NAMES[level],
      category: context?.category || this.childContext.category || this.config.defaultCategory,
      message,
      env: this.config.env,
    };

    // Merge all context sources
    const mergedContext = {
      ...this.config.globalContext,
      ...this.childContext,
      ...context,
    };

    // Remove category from context (it's already at top level)
    delete mergedContext.category;

    // Only add context if there's meaningful data
    if (Object.keys(mergedContext).length > 0) {
      entry.context = mergedContext;
    }

    // Handle Error objects
    if (context && context.error instanceof Error) {
      entry.stack = context.error.stack;
      // Don't duplicate the error object in context
      if (entry.context) {
        const { error, ...rest } = entry.context;
        entry.context = Object.keys(rest).length > 0 ? rest : undefined;
      }
    }

    // Write to all transports
    for (const transport of this.config.transports) {
      if (level >= transport.minLevel) {
        try {
          transport.write(entry);
        } catch (err) {
          // Fallback to console if transport fails
          console.error(`[Logger] Transport "${transport.name}" failed:`, err);
        }
      }
    }
  }

  /**
   * Log a TRACE level message (most verbose)
   */
  trace(message: string, context?: LogContext): void {
    this.log(LogLevel.TRACE, message, context);
  }

  /**
   * Log a DEBUG level message
   */
  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log an INFO level message
   */
  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log a WARN level message
   */
  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log an ERROR level message
   */
  error(message: string, context?: LogContext): void {
    this.log(LogLevel.ERROR, message, context);
  }

  /**
   * Log a FATAL level message (most severe)
   */
  fatal(message: string, context?: LogContext): void {
    this.log(LogLevel.FATAL, message, context);
  }

  /**
   * Log an error with stack trace
   */
  logError(message: string, error: Error, context?: LogContext): void {
    this.log(LogLevel.ERROR, message, {
      ...context,
      error,
      errorMessage: error.message,
      errorName: error.name,
    });
  }

  /**
   * Start a timer for performance logging
   */
  startTimer(label: string): () => void {
    const start = performance.now();
    return () => {
      const durationMs = performance.now() - start;
      this.debug(`${label} completed`, { durationMs, category: 'PERF' });
    };
  }

  /**
   * Flush all transports
   */
  async flush(): Promise<void> {
    await Promise.all(
      this.config.transports.map(t => t.flush?.())
    );
  }

  /**
   * Close all transports
   */
  async close(): Promise<void> {
    await Promise.all(
      this.config.transports.map(t => t.close?.())
    );
  }

  /**
   * Get current configuration
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  /**
   * Update minimum log level at runtime
   */
  setMinLevel(level: LogLevel): void {
    this.config.minLevel = level;
  }

  /**
   * Add a transport at runtime
   */
  addTransport(transport: LogTransport): void {
    this.config.transports.push(transport);
  }

  /**
   * Remove a transport by name
   */
  removeTransport(name: string): void {
    this.config.transports = this.config.transports.filter(t => t.name !== name);
  }
}

/**
 * Create a logger with minimal configuration (for quick setup)
 */
export function createLogger(options: {
  env: 'client' | 'server';
  minLevel?: LogLevel;
  defaultCategory?: LogCategory;
  transports?: LogTransport[];
  globalContext?: LogContext;
}): Logger {
  return new Logger({
    env: options.env,
    minLevel: options.minLevel ?? LogLevel.INFO,
    defaultCategory: options.defaultCategory ?? 'GENERAL',
    transports: options.transports ?? [],
    globalContext: options.globalContext,
  });
}
