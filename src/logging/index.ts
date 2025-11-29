/**
 * Client-Side Logger Configuration
 * 
 * This module creates and exports the main logger instance for the browser client.
 * It uses console transport only (no file access in browser).
 */

import { createLogger, parseLogLevel } from '@shared/logging/index.ts';
import { ConsoleTransport } from '@shared/logging/transports/ConsoleTransport.ts';
import type { LogTransport } from '@shared/logging/types.ts';

// Read configuration from URL params or localStorage
function getLogLevel(): string {
  // Check URL params first (for quick debugging)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const urlLevel = params.get('logLevel');
    if (urlLevel) return urlLevel;
    
    // Check localStorage
    const storedLevel = localStorage.getItem('logLevel');
    if (storedLevel) return storedLevel;
  }
  
  // Default to INFO - use setLogLevel('DEBUG') or ?logLevel=DEBUG for debugging
  return 'INFO';
}

const LOG_LEVEL = parseLogLevel(getLogLevel());

// Console transport - works great in browser with grouping
const consoleTransport = new ConsoleTransport({
  minLevel: LOG_LEVEL,
  useColors: false, // Browser doesn't support ANSI colors well, but has its own
  usePrefixes: true,
  showTimestamp: true,
  showContext: true,
  timestampFormat: 'time',
});

const transports: LogTransport[] = [consoleTransport];

/**
 * Main client logger instance
 * 
 * @example
 * ```typescript
 * import { logger } from './logging';
 * 
 * logger.info('App mounted', { category: 'RENDER' });
 * 
 * // Create category-specific loggers
 * const renderLogger = logger.forCategory('RENDER');
 * renderLogger.debug('Canvas initialized');
 * 
 * // Create agent-specific loggers (for tracking selected agent)
 * const agentLogger = logger.forAgent('agent-1', 'Orange');
 * agentLogger.trace('Position updated');
 * ```
 */
export const logger = createLogger({
  env: 'client',
  minLevel: LOG_LEVEL,
  defaultCategory: 'GENERAL',
  transports,
});

// Pre-created category loggers for convenience
export const renderLogger = logger.forCategory('RENDER');
export const audioLogger = logger.forCategory('AUDIO');
export const websocketLogger = logger.forCategory('WEBSOCKET');
export const simulationLogger = logger.forCategory('SIMULATION');
export const systemLogger = logger.forCategory('SYSTEM');
export const movementLogger = logger.forCategory('MOVEMENT');
export const zoneLogger = logger.forCategory('ZONE');
export const aiLogger = logger.forCategory('AI');
export const errorLogger = logger.forCategory('ERROR');

// Utility function to change log level at runtime
export function setLogLevel(level: string): void {
  const parsed = parseLogLevel(level);
  logger.setMinLevel(parsed);
  if (typeof window !== 'undefined') {
    localStorage.setItem('logLevel', level);
  }
  logger.info('Log level changed', { newLevel: level });
}

// Make logger available globally for debugging
if (typeof window !== 'undefined') {
  (window as unknown as { setLogLevel: typeof setLogLevel }).setLogLevel = setLogLevel;
  (window as unknown as { __logger: typeof logger }).__logger = logger;
}

export default logger;
