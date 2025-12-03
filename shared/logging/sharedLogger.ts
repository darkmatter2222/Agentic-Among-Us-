/**
 * Shared Logger Instance
 * 
 * This module provides a lazy-initialized logger that works in both
 * client and server environments. It defers initialization until first use
 * to avoid import issues with environment-specific code.
 */

import { Logger, createLogger } from './Logger.ts';
import { LogLevel, parseLogLevel } from './LogLevel.ts';
import { ConsoleTransport } from './transports/ConsoleTransport.ts';
import type { LogTransport, LogCategory } from './types.ts';

let _logger: Logger | null = null;

/**
 * Detect the current environment
 */
function detectEnvironment(): 'client' | 'server' {
  if (typeof window !== 'undefined') {
    return 'client';
  }
  return 'server';
}

/**
 * Get the configured log level
 */
function getLogLevel(): LogLevel {
  // Check environment variables (works in both Node and Vite)
  if (typeof process !== 'undefined' && process.env?.LOG_LEVEL) {
    return parseLogLevel(process.env.LOG_LEVEL);
  }
  
  // Check browser URL params or localStorage
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const urlLevel = params.get('logLevel');
    if (urlLevel) return parseLogLevel(urlLevel);
    
    const storedLevel = localStorage.getItem('logLevel');
    if (storedLevel) return parseLogLevel(storedLevel);
  }
  
  // Default based on environment
  try {
    // Check if we're in dev mode (Vite)
    // @ts-expect-error - Vite-specific
    if (import.meta.env?.DEV) {
      return LogLevel.DEBUG;
    }
  } catch {
    // Not in Vite
  }
  
  return LogLevel.INFO;
}

/**
 * Initialize the shared logger
 */
function initializeLogger(): Logger {
  const env = detectEnvironment();
  const logLevel = getLogLevel();
  
  const transports: LogTransport[] = [
    new ConsoleTransport({
      minLevel: logLevel,
      useColors: env === 'server',
      usePrefixes: true,
      showTimestamp: true,
      showContext: true,
      timestampFormat: 'time',
    }),
  ];
  
  return createLogger({
    env,
    minLevel: logLevel,
    defaultCategory: 'GENERAL',
    transports,
  });
}

/**
 * Get the shared logger instance (lazy initialization)
 */
export function getLogger(): Logger {
  if (!_logger) {
    _logger = initializeLogger();
  }
  return _logger;
}

/**
 * Get a logger for a specific category
 */
export function getCategoryLogger(category: LogCategory): Logger {
  return getLogger().forCategory(category);
}

/**
 * Get a logger for a specific agent
 */
export function getAgentLogger(agentId: string, agentName?: string): Logger {
  return getLogger().forAgent(agentId, agentName);
}

// Pre-created category loggers (lazy)
export const aiLog = { get: () => getCategoryLogger('AI') };
export const simLog = { get: () => getCategoryLogger('SIMULATION') };
export const wsLog = { get: () => getCategoryLogger('WEBSOCKET') };
export const moveLog = { get: () => getCategoryLogger('MOVEMENT') };
export const taskLog = { get: () => getCategoryLogger('TASK') };
export const killLog = { get: () => getCategoryLogger('KILL') };
export const ventLog = { get: () => getCategoryLogger('VENT') };
export const meetingLog = { get: () => getCategoryLogger('MEETING') };
export const sabotageLog = { get: () => getCategoryLogger('SABOTAGE') };
export const memLog = { get: () => getCategoryLogger('MEMORY') };
export const speechLog = { get: () => getCategoryLogger('SPEECH') };
export const thoughtLog = { get: () => getCategoryLogger('THOUGHT') };
export const visionLog = { get: () => getCategoryLogger('VISION') };
export const zoneLog = { get: () => getCategoryLogger('ZONE') };
export const perfLog = { get: () => getCategoryLogger('PERF') };
export const sysLog = { get: () => getCategoryLogger('SYSTEM') };
export const godLog = { get: () => getCategoryLogger('GOD') };
