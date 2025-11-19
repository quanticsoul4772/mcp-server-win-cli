/**
 * Logger Service
 *
 * Structured logging infrastructure for the MCP server.
 * All output goes to stderr since stdout is reserved for MCP protocol.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface LoggerConfig {
  level: LogLevel;
  structured: boolean;
  timestamps: boolean;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_LEVEL_SYMBOLS: Record<LogLevel, string> = {
  debug: '[DEBUG]',
  info: '[INFO]',
  warn: '[WARN]',
  error: '[ERROR]',
};

/**
 * Logger class for structured logging
 *
 * Usage:
 * ```typescript
 * const logger = new Logger('SSH');
 * logger.info('Connection established', { host: 'example.com', port: 22 });
 * logger.error('Connection failed', { error: err.message });
 * logger.warn('Idle timeout approaching', { remainingMs: 5000 });
 * logger.debug('Raw packet received', { bytes: 1024 });
 * ```
 */
export class Logger {
  private static globalConfig: LoggerConfig = {
    level: 'info',
    structured: false,
    timestamps: true,
  };

  private category: string;

  constructor(category: string) {
    this.category = category;
  }

  /**
   * Configure global logger settings
   */
  static configure(config: Partial<LoggerConfig>): void {
    Logger.globalConfig = { ...Logger.globalConfig, ...config };
  }

  /**
   * Get current configuration
   */
  static getConfig(): LoggerConfig {
    return { ...Logger.globalConfig };
  }

  /**
   * Set log level from string (for config parsing)
   */
  static setLevel(level: string): void {
    if (level in LOG_LEVEL_PRIORITY) {
      Logger.globalConfig.level = level as LogLevel;
    }
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[Logger.globalConfig.level];
  }

  /**
   * Format and output a log entry
   */
  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    if (Logger.globalConfig.structured) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        category: this.category,
        message,
        ...(data && { data }),
      };
      console.error(JSON.stringify(entry));
    } else {
      const parts: string[] = [];

      if (Logger.globalConfig.timestamps) {
        parts.push(new Date().toISOString());
      }

      parts.push(LOG_LEVEL_SYMBOLS[level]);
      parts.push(`[${this.category}]`);
      parts.push(message);

      if (data && Object.keys(data).length > 0) {
        // Format data inline for readability
        const dataStr = Object.entries(data)
          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join(' ');
        parts.push(`(${dataStr})`);
      }

      console.error(parts.join(' '));
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  /**
   * Log info message
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  /**
   * Log error message
   */
  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  /**
   * Log a security-related message (always at warn or error level)
   */
  security(message: string, data?: Record<string, unknown>): void {
    this.log('warn', `[SECURITY] ${message}`, data);
  }

  /**
   * Log a critical security alert (always at error level)
   */
  securityAlert(message: string, data?: Record<string, unknown>): void {
    this.log('error', `[SECURITY ALERT] ${message}`, data);
  }

  /**
   * Create a child logger with a sub-category
   */
  child(subCategory: string): Logger {
    return new Logger(`${this.category}:${subCategory}`);
  }
}

// Pre-configured loggers for common categories
export const loggers = {
  server: new Logger('Server'),
  config: new Logger('Config'),
  security: new Logger('Security'),
  ssh: new Logger('SSH'),
  command: new Logger('Command'),
  history: new Logger('History'),
  session: new Logger('Session'),
  knownHosts: new Logger('KnownHosts'),
};

// Default export for convenience
export default Logger;
