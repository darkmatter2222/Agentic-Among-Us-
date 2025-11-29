import { LogLevel } from './LogLevel.ts';

/**
 * Log categories for structured logging namespaces
 */
export type LogCategory =
  | 'AI'           // AI decision making, LLM calls
  | 'SIMULATION'   // Game simulation, ticks, state
  | 'WEBSOCKET'    // WebSocket connections, messages
  | 'RENDER'       // Client-side rendering
  | 'AUDIO'        // Audio playback
  | 'MOVEMENT'     // Agent movement, pathfinding
  | 'TASK'         // Task execution
  | 'KILL'         // Kill events
  | 'VENT'         // Vent events
  | 'MEETING'      // Meeting/voting events
  | 'SABOTAGE'     // Sabotage events
  | 'MEMORY'       // Agent memory
  | 'VISION'       // Vision/line-of-sight
  | 'ZONE'         // Zone detection
  | 'HTTP'         // HTTP requests
  | 'SYSTEM'       // System-level events
  | 'PERF'         // Performance metrics
  | 'GOD'          // God mode commands
  | 'SPEECH'       // Agent speech
  | 'THOUGHT'      // Agent thoughts
  | 'ERROR'        // Error handling
  | 'GENERAL';     // General/uncategorized

/**
 * Context information attached to every log entry
 */
export interface LogContext {
  /** Log category/namespace */
  category?: LogCategory;
  /** Agent ID if relevant */
  agentId?: string;
  /** Agent name if relevant */
  agentName?: string;
  /** Current simulation tick */
  tick?: number;
  /** Request/trace ID for correlation */
  requestId?: string;
  /** Current zone/room name */
  zone?: string;
  /** Duration in milliseconds for timed operations */
  durationMs?: number;
  /** Any additional structured data */
  [key: string]: unknown;
}

/**
 * A single log entry
 */
export interface LogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Epoch time in milliseconds */
  epochMs: number;
  /** Log level */
  level: LogLevel;
  /** Log level name */
  levelName: string;
  /** Log category */
  category: LogCategory;
  /** Log message */
  message: string;
  /** Additional context */
  context?: LogContext;
  /** Error stack trace if applicable */
  stack?: string;
  /** Source file/module (if available) */
  source?: string;
  /** Environment (client/server) */
  env: 'client' | 'server';
}

/**
 * Transport interface - destinations for log output
 */
export interface LogTransport {
  /** Transport name for identification */
  name: string;
  /** Minimum log level this transport handles */
  minLevel: LogLevel;
  /** Write a log entry */
  write(entry: LogEntry): void | Promise<void>;
  /** Flush any buffered logs */
  flush?(): void | Promise<void>;
  /** Close/cleanup the transport */
  close?(): void | Promise<void>;
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Minimum log level (logs below this are ignored) */
  minLevel: LogLevel;
  /** Default category for logs without explicit category */
  defaultCategory: LogCategory;
  /** Environment identifier */
  env: 'client' | 'server';
  /** Transports to write logs to */
  transports: LogTransport[];
  /** Global context added to all logs */
  globalContext?: LogContext;
}
