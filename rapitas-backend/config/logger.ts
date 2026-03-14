/**
 * Central logger module - pino based
 * All log output goes through this module
 */
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Root logger instance
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

/**
 * Generate named child logger
 */
export function createLogger(name: string): pino.Logger {
  return logger.child({ name });
}
