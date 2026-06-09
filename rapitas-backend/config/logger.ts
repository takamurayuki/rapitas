/**
 * Central logger module - pino based
 *
 * All log output goes through this module. Console output is unchanged
 * (pretty in dev, JSON in prod). Additionally, warn/error/fatal entries are
 * appended as NDJSON to a daily file (~/.rapitas/logs/backend-YYYY-MM-DD.log)
 * so the daily log-health-check job can extract today's problems. The file
 * sink never throws — logging must never crash the app.
 */
import { createWriteStream, mkdirSync, type WriteStream } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import pino, { type StreamEntry, type DestinationStream } from 'pino';
import pretty from 'pino-pretty';

const isDev = process.env.NODE_ENV !== 'production';
// NOTE: bun test automatically sets NODE_ENV=test; this flag disables the file
// sink so test-generated errors never contaminate the daily log file and trigger
// false log-health-check alerts.
const isTest = process.env.NODE_ENV === 'test';

/** Directory holding the daily backend log files (override via RAPITAS_DATA_DIR). */
function getLogsDir(): string {
  const override = process.env.RAPITAS_DATA_DIR;
  const base = override && override.trim().length > 0 ? override : join(homedir(), '.rapitas');
  return join(base, 'logs');
}

/** Local YYYY-MM-DD stamp for a date (defaults to now). */
function dateStamp(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Absolute path of the backend warn/error log file for a given day.
 *
 * @param stamp - YYYY-MM-DD day (defaults to today) / 対象日
 * @returns Log file path / ログファイルパス
 */
export function getBackendLogFilePath(stamp: string = dateStamp()): string {
  return join(getLogsDir(), `backend-${stamp}.log`);
}

/**
 * A pino destination that appends to a per-day log file, rotating the handle
 * when the local date changes (so an always-on process still writes to
 * "today's" file across midnight).
 */
function createDailyWarnSink(): DestinationStream {
  let currentStamp = '';
  let stream: WriteStream | null = null;

  function ensureStream(): WriteStream | null {
    const stamp = dateStamp();
    if (stamp === currentStamp && stream) return stream;
    try {
      mkdirSync(getLogsDir(), { recursive: true });
      stream?.end();
      stream = createWriteStream(getBackendLogFilePath(stamp), { flags: 'a' });
      currentStamp = stamp;
    } catch {
      // If the file can't be opened, drop file logging rather than crash.
      stream = null;
    }
    return stream;
  }

  return {
    write(chunk: string): void {
      try {
        ensureStream()?.write(chunk);
      } catch {
        // Never let a logging failure propagate.
      }
    },
  };
}

const consoleStream: DestinationStream = isDev
  ? pretty({
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname',
    })
  : pino.destination({ dest: 1, sync: false });

const streams: StreamEntry[] = [
  { level: isDev ? 'debug' : 'info', stream: consoleStream },
  // Persist warn/error/fatal to the daily file for the health-check job.
  // Disabled in test environments (isTest) to prevent test throws from
  // contaminating the shared daily log file.
  ...(isTest ? [] : [{ level: 'warn' as const, stream: createDailyWarnSink() }]),
];

/**
 * Root logger instance
 */
export const logger = pino(
  { level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info') },
  pino.multistream(streams),
);

/**
 * Generate named child logger
 */
export function createLogger(name: string): pino.Logger {
  return logger.child({ name });
}
