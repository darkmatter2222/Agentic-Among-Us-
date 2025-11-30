/**
 * Universal Logging System for Agentic Among Us
 * 
 * This module provides a comprehensive, structured logging system with:
 * - Multiple log levels (TRACE, DEBUG, INFO, WARN, ERROR, FATAL)
 * - Category/namespace support for filtering
 * - Color-coded console output with emojis
 * - Rolling JSON file logs (server-side)
 * - Context enrichment (agentId, tick, zone, etc.)
 * - Performance timing helpers
 * 
 * @example
 * ```typescript
 * import { logger } from '@shared/logging';
 * 
 * // Basic logging
 * logger.info('Agent started', { category: 'AI', agentId: 'agent-1' });
 * 
 * // Create a child logger for an agent
 * const agentLogger = logger.forAgent('agent-1', 'Orange');
 * agentLogger.debug('Moving to task');
 * 
 * // Performance timing
 * const endTimer = logger.startTimer('pathfinding');
 * // ... do work ...
 * endTimer(); // Logs: "pathfinding completed {durationMs: 42}"
 * ```
 */

// Core exports
export { Logger, createLogger } from './Logger.ts';
export { LogLevel, LOG_LEVEL_NAMES, parseLogLevel } from './LogLevel.ts';
export type {
  LogCategory,
  LogContext,
  LogEntry,
  LogTransport,
  LoggerConfig,
} from './types.ts';

// Transport exports
export * from './transports/index.ts';

// Shared logger exports (for use in shared/ code)
export {
  getLogger,
  getCategoryLogger,
  getAgentLogger,
  aiLog,
  simLog,
  wsLog,
  moveLog,
  taskLog,
  killLog,
  ventLog,
  sabotageLog,
  memLog,
  speechLog,
  thoughtLog,
  visionLog,
  zoneLog,
  perfLog,
  sysLog,
  godLog,
} from './sharedLogger.ts';
