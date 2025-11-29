import { LogLevel, LOG_LEVEL_NAMES } from '../LogLevel.ts';
import type { LogEntry, LogTransport, LogCategory } from '../types.ts';

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
  // Log levels
  TRACE: '\x1b[90m',      // Gray
  DEBUG: '\x1b[36m',      // Cyan
  INFO: '\x1b[32m',       // Green
  WARN: '\x1b[33m',       // Yellow
  ERROR: '\x1b[31m',      // Red
  FATAL: '\x1b[35m',      // Magenta (bright)
  
  // Categories
  AI: '\x1b[95m',         // Light Magenta
  SIMULATION: '\x1b[94m', // Light Blue
  WEBSOCKET: '\x1b[96m',  // Light Cyan
  RENDER: '\x1b[93m',     // Light Yellow
  AUDIO: '\x1b[92m',      // Light Green
  MOVEMENT: '\x1b[34m',   // Blue
  TASK: '\x1b[33m',       // Yellow
  KILL: '\x1b[91m',       // Light Red
  VENT: '\x1b[35m',       // Magenta
  MEETING: '\x1b[36m',    // Cyan
  SABOTAGE: '\x1b[31m',   // Red
  MEMORY: '\x1b[90m',     // Gray
  VISION: '\x1b[37m',     // White
  ZONE: '\x1b[34m',       // Blue
  HTTP: '\x1b[96m',       // Light Cyan
  SYSTEM: '\x1b[97m',     // Bright White
  PERF: '\x1b[93m',       // Light Yellow
  GOD: '\x1b[95m',        // Light Magenta (divine!)
  SPEECH: '\x1b[92m',     // Light Green
  THOUGHT: '\x1b[94m',    // Light Blue
  GENERAL: '\x1b[37m',    // White
  
  // Utility
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  TIMESTAMP: '\x1b[90m',  // Gray for timestamps
  CONTEXT: '\x1b[90m',    // Gray for context
} as const;

/**
 * Level-specific prefixes for visual distinction (no emojis)
 */
const LEVEL_PREFIXES: Record<string, string> = {
  TRACE: '[TRC]',
  DEBUG: '[DBG]',
  INFO:  '[INF]',
  WARN:  '[WRN]',
  ERROR: '[ERR]',
  FATAL: '[FTL]',
};

/**
 * Category-specific short labels (no emojis)
 */
const CATEGORY_LABELS: Record<LogCategory, string> = {
  AI:         'AI',
  SIMULATION: 'SIM',
  WEBSOCKET:  'WS',
  RENDER:     'RND',
  AUDIO:      'AUD',
  MOVEMENT:   'MOV',
  TASK:       'TSK',
  KILL:       'KIL',
  VENT:       'VNT',
  MEETING:    'MTG',
  SABOTAGE:   'SAB',
  MEMORY:     'MEM',
  VISION:     'VIS',
  ZONE:       'ZON',
  HTTP:       'HTTP',
  SYSTEM:     'SYS',
  PERF:       'PERF',
  GOD:        'GOD',
  SPEECH:     'SPK',
  THOUGHT:    'THT',
  ERROR:      'ERR',
  GENERAL:    'GEN',
};

export interface ConsoleTransportOptions {
  /** Use colors in output (default: true in Node, auto-detect in browser) */
  useColors?: boolean;
  /** Use level/category prefixes (default: true) */
  usePrefixes?: boolean;
  /** Show timestamp (default: true) */
  showTimestamp?: boolean;
  /** Show context details (default: true) */
  showContext?: boolean;
  /** Timestamp format: 'iso' | 'time' | 'epoch' */
  timestampFormat?: 'iso' | 'time' | 'epoch';
  /** Pretty print JSON context (default: true for readable output) */
  prettyPrintContext?: boolean;
  /** Minimum log level for this transport */
  minLevel?: LogLevel;
  /** Max width for context values before truncation (default: 80) */
  maxContextValueLength?: number;
}

/**
 * Console Transport - Beautiful color-coded console output
 * 
 * Works in both Node.js and browser environments with automatic
 * detection and appropriate styling.
 */
export class ConsoleTransport implements LogTransport {
  name = 'console';
  minLevel: LogLevel;
  
  private options: Required<ConsoleTransportOptions>;
  private isBrowser: boolean;

  constructor(options: ConsoleTransportOptions = {}) {
    this.isBrowser = typeof window !== 'undefined';
    this.minLevel = options.minLevel ?? LogLevel.DEBUG;
    
    this.options = {
      useColors: options.useColors ?? !this.isBrowser,
      usePrefixes: options.usePrefixes ?? true,
      showTimestamp: options.showTimestamp ?? true,
      showContext: options.showContext ?? true,
      timestampFormat: options.timestampFormat ?? 'time',
      prettyPrintContext: options.prettyPrintContext ?? true,
      minLevel: this.minLevel,
      maxContextValueLength: options.maxContextValueLength ?? 80,
    };
  }

  write(entry: LogEntry): void {
    const output = this.options.useColors
      ? this.formatColored(entry)
      : this.formatPlain(entry);

    // Use appropriate console method based on level
    const consoleMethod = this.getConsoleMethod(entry.level);
    
    if (this.isBrowser) {
      // Browser: use console grouping for context
      if (this.options.showContext && entry.context && Object.keys(entry.context).length > 0) {
        console.groupCollapsed(output);
        console.log(entry.context);
        if (entry.stack) {
          console.log(entry.stack);
        }
        console.groupEnd();
      } else {
        consoleMethod(output);
        if (entry.stack) {
          console.log(entry.stack);
        }
      }
    } else {
      // Node.js: single line with optional context
      consoleMethod(output);
      if (entry.stack) {
        console.log(COLORS.DIM + entry.stack + COLORS.RESET);
      }
    }
  }

  private formatColored(entry: LogEntry): string {
    const parts: string[] = [];
    
    // Timestamp in dim color
    if (this.options.showTimestamp) {
      const ts = this.formatTimestamp(entry);
      parts.push(`${COLORS.TIMESTAMP}${ts}${COLORS.RESET}`);
    }
    
    // Level with color - fixed width for alignment
    const levelColor = COLORS[entry.levelName as keyof typeof COLORS] || COLORS.RESET;
    const levelPrefix = this.options.usePrefixes ? LEVEL_PREFIXES[entry.levelName] : entry.levelName.padEnd(5);
    parts.push(`${levelColor}${COLORS.BOLD}${levelPrefix}${COLORS.RESET}`);
    
    // Category with color - padded for alignment
    const categoryColor = COLORS[entry.category as keyof typeof COLORS] || COLORS.GENERAL;
    const categoryLabel = CATEGORY_LABELS[entry.category] || entry.category;
    parts.push(`${categoryColor}${categoryLabel.padEnd(4)}${COLORS.RESET}`);
    
    // Agent name if present - highlighted
    if (entry.context?.agentName) {
      parts.push(`${COLORS.BOLD}${categoryColor}<${entry.context.agentName}>${COLORS.RESET}`);
    }
    
    // Message - main content
    parts.push(entry.message);
    
    // Context - pretty printed on new lines
    if (this.options.showContext && entry.context) {
      const contextStr = this.formatContext(entry.context);
      if (contextStr) {
        parts.push(`${COLORS.CONTEXT}${contextStr}${COLORS.RESET}`);
      }
    }
    
    return parts.join(' ');
  }

  private formatPlain(entry: LogEntry): string {
    const parts: string[] = [];
    
    if (this.options.showTimestamp) {
      parts.push(this.formatTimestamp(entry));
    }
    
    const levelPrefix = this.options.usePrefixes ? LEVEL_PREFIXES[entry.levelName] : entry.levelName.padEnd(5);
    parts.push(levelPrefix);
    
    const categoryLabel = CATEGORY_LABELS[entry.category] || entry.category;
    parts.push(categoryLabel.padEnd(4));
    
    if (entry.context?.agentName) {
      parts.push(`<${entry.context.agentName}>`);
    }
    
    parts.push(entry.message);
    
    if (this.options.showContext && entry.context) {
      const contextStr = this.formatContext(entry.context);
      if (contextStr) {
        parts.push(contextStr);
      }
    }
    
    return parts.join(' ');
  }

  private formatTimestamp(entry: LogEntry): string {
    switch (this.options.timestampFormat) {
      case 'iso':
        return entry.timestamp;
      case 'epoch':
        return String(entry.epochMs);
      case 'time':
      default:
        // Extract just the time portion HH:MM:SS.mmm
        return entry.timestamp.split('T')[1].replace('Z', '');
    }
  }

  private formatContext(context: LogContext): string {
    // Filter out fields that are already displayed elsewhere
    const { agentName, agentId, category, ...rest } = context;
    
    if (Object.keys(rest).length === 0) {
      return '';
    }
    
    if (this.options.prettyPrintContext) {
      return '\n' + JSON.stringify(rest, null, 2);
    }
    
    // Compact single-line format
    const pairs = Object.entries(rest)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        if (typeof v === 'object') {
          return `${k}=${JSON.stringify(v)}`;
        }
        return `${k}=${v}`;
      });
    
    return pairs.length > 0 ? `{${pairs.join(', ')}}` : '';
  }

  private getConsoleMethod(level: LogLevel): typeof console.log {
    switch (level) {
      case LogLevel.TRACE:
      case LogLevel.DEBUG:
        return console.debug;
      case LogLevel.INFO:
        return console.info;
      case LogLevel.WARN:
        return console.warn;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        return console.error;
      default:
        return console.log;
    }
  }
}

// Re-export for convenience
interface LogContext {
  agentName?: string;
  agentId?: string;
  category?: LogCategory;
  [key: string]: unknown;
}
