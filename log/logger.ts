/**
 * log/logger.ts
 * Structured logger — thin wrapper around console that adds level, timestamp,
 * and context to every log entry. Never swallows errors.
 *
 * Usage:
 *   import { logger } from '../../log/logger';
 *   const log = logger('search');
 *   log.info('Cache hit', { key, ttl });
 *   log.error('D1 query failed', err);
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  timestamp: string;
  data?: unknown;
}

function emit(level: LogLevel, module: string, message: string, data?: unknown): void {
  const entry: LogEntry = {
    level,
    module,
    message,
    timestamp: new Date().toISOString(),
    ...(data !== undefined && { data }),
  };

  const formatted = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}`;

  switch (level) {
    case 'debug':
      console.debug(formatted, data !== undefined ? data : '');
      break;
    case 'info':
      console.info(formatted, data !== undefined ? data : '');
      break;
    case 'warn':
      console.warn(formatted, data !== undefined ? data : '');
      break;
    case 'error':
      console.error(formatted, data !== undefined ? data : '');
      break;
  }
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/** Creates a module-scoped logger instance. */
export function logger(module: string): Logger {
  return {
    debug: (msg, data) => emit('debug', module, msg, data),
    info:  (msg, data) => emit('info',  module, msg, data),
    warn:  (msg, data) => emit('warn',  module, msg, data),
    error: (msg, data) => emit('error', module, msg, data),
  };
}
