/**
 * Server-Side Logger Configuration
 * 
 * This module creates and exports the main logger instance for the server.
 * It configures both console and rolling file transports.
 */

import { createLogger, LogLevel, parseLogLevel } from '@shared/logging/index.ts';
import { ConsoleTransport } from '@shared/logging/transports/ConsoleTransport.ts';
import { FileTransport } from '@shared/logging/transports/FileTransport.ts';
import type { LogTransport } from '@shared/logging/types.ts';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Determine log directory (relative to server root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = join(__dirname, '..', '..', 'logs');

// Read configuration from environment
const LOG_LEVEL = parseLogLevel(process.env.LOG_LEVEL ?? 'DEBUG');
const LOG_MAX_FILES = parseInt(process.env.LOG_MAX_FILES ?? '1', 10);
const LOG_MAX_FILE_SIZE = parseInt(process.env.LOG_MAX_FILE_SIZE ?? String(1024 * 1024 * 1024), 10); // 1GB default
const LOG_TO_FILE = (process.env.LOG_TO_FILE ?? 'true').toLowerCase() === 'true';

// Console transport with beautiful colors
const consoleTransport = new ConsoleTransport({
  minLevel: LOG_LEVEL,
  useColors: true,
  usePrefixes: true,
  showTimestamp: true,
  showContext: true,
  timestampFormat: 'time',
});

// Build transports array
const transports: LogTransport[] = [consoleTransport];

// Only add file transport if enabled and in production-like environment
if (LOG_TO_FILE) {
  const fileTransport = new FileTransport({
    logDir: LOG_DIR,
    baseFilename: 'server',
    maxFileSize: LOG_MAX_FILE_SIZE,
    maxFiles: LOG_MAX_FILES,
    minLevel: LogLevel.DEBUG, // File always gets DEBUG and above
    bufferSize: 50,
    flushIntervalMs: 3000,
  });
  transports.push(fileTransport);
}

/**
 * Main server logger instance
 * 
 * @example
 * ```typescript
 * import { logger } from './logging';
 * 
 * logger.info('Server started', { category: 'SYSTEM', port: 4000 });
 * 
 * // Create category-specific loggers
 * const aiLogger = logger.forCategory('AI');
 * aiLogger.debug('LLM request started', { agentId: 'agent-1' });
 * 
 * // Create agent-specific loggers
 * const agentLogger = logger.forAgent('agent-1', 'Orange');
 * agentLogger.info('Decided to kill', { target: 'Blue' });
 * ```
 */
export const logger = createLogger({
  env: 'server',
  minLevel: LOG_LEVEL,
  defaultCategory: 'GENERAL',
  transports,
});

// Pre-created category loggers for convenience
export const aiLogger = logger.forCategory('AI');
export const simulationLogger = logger.forCategory('SIMULATION');
export const websocketLogger = logger.forCategory('WEBSOCKET');
export const httpLogger = logger.forCategory('HTTP');
export const systemLogger = logger.forCategory('SYSTEM');
export const perfLogger = logger.forCategory('PERF');
export const taskLogger = logger.forCategory('TASK');
export const killLogger = logger.forCategory('KILL');
export const ventLogger = logger.forCategory('VENT');
export const movementLogger = logger.forCategory('MOVEMENT');
export const memoryLogger = logger.forCategory('MEMORY');
export const speechLogger = logger.forCategory('SPEECH');
export const thoughtLogger = logger.forCategory('THOUGHT');
export const godLogger = logger.forCategory('GOD');

// Log startup info
systemLogger.info('Server logger initialized', {
  logLevel: LOG_LEVEL,
  logDir: LOG_DIR,
  fileLogging: LOG_TO_FILE,
  maxFiles: LOG_MAX_FILES,
});

export default logger;
