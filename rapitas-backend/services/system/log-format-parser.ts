/**
 * log-format-parser
 *
 * Parses a project's log file content into normalized warn+ entries, supporting
 * the formats projects actually use: pino/NDJSON, generic JSON-per-line, and
 * plain text with level keywords. Used by the log health check to read each
 * project's logs regardless of how that project logs. Returns only warn/error/
 * fatal entries (the only ones the health check cares about).
 */
import type { LogFormat } from '../scheduling/theme-backlog-override-service';

export interface ParsedLogEntry {
  /** pino numeric level: warn=40, error=50, fatal=60. */
  level: number;
  name?: string;
  msg: string;
  stack?: string;
  /** Epoch ms when known (lets the health check keep only today's entries). */
  time?: number;
}

/** Minimum level kept (warn). */
const WARN = 40;

/** Level words → pino numeric level. */
const LEVEL_WORDS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  warning: 40,
  notice: 30,
  error: 50,
  err: 50,
  severe: 50,
  fatal: 60,
  critical: 60,
  crit: 60,
  panic: 60,
};

function levelFromValue(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const asNum = Number(v);
    if (Number.isFinite(asNum) && v.trim() !== '') return asNum;
    return LEVEL_WORDS[v.toLowerCase()] ?? null;
  }
  return null;
}

/** Parses an epoch-ms or ISO timestamp into epoch ms, or undefined. */
function timeFromValue(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

interface RawObject {
  [k: string]: unknown;
}

/** First present key from a candidate list. */
function pick(obj: RawObject, keys: string[]): unknown {
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
}

function parsePino(line: string): ParsedLogEntry | null {
  let obj: RawObject;
  try {
    obj = JSON.parse(line) as RawObject;
  } catch {
    return null; // pino is strictly JSON lines
  }
  const level = levelFromValue(obj.level);
  if (level === null) return null;
  const err = obj.err as { message?: string; stack?: string } | undefined;
  const msg = (err?.message as string) || (obj.msg as string) || '(メッセージなし)';
  return {
    level,
    name: typeof obj.name === 'string' ? obj.name : undefined,
    msg,
    stack: typeof err?.stack === 'string' ? err.stack : undefined,
    time: timeFromValue(obj.time),
  };
}

function parseGenericJson(line: string): ParsedLogEntry | null {
  let obj: RawObject;
  try {
    obj = JSON.parse(line) as RawObject;
  } catch {
    return parseText(line); // tolerate non-JSON lines in a "json" log
  }
  const level = levelFromValue(pick(obj, ['level', 'severity', 'lvl', 'loglevel', 'log_level']));
  if (level === null) return null;
  const msg = pick(obj, ['msg', 'message', 'text', 'error', 'err', 'detail']);
  const name = pick(obj, ['name', 'logger', 'module', 'component', 'service']);
  const time = pick(obj, ['time', 'timestamp', 'ts', '@timestamp', 'date']);
  return {
    level,
    name: typeof name === 'string' ? name : undefined,
    msg: typeof msg === 'string' ? msg : JSON.stringify(msg ?? '(メッセージなし)'),
    time: timeFromValue(time),
  };
}

const TEXT_LEVEL_RE = /\b(fatal|panic|critical|crit|severe|error|err|warning|warn)\b/i;

function parseText(line: string): ParsedLogEntry | null {
  const m = line.match(TEXT_LEVEL_RE);
  if (!m) return null;
  const level = LEVEL_WORDS[m[1].toLowerCase()] ?? WARN;
  return { level, msg: line.slice(0, 500) };
}

/**
 * Parses log file content into normalized warn+ entries.
 *
 * @param content - Raw file content / ファイル内容
 * @param format - How the file is formatted / ログ形式
 * @returns Warn/error/fatal entries / warn以上のエントリ
 */
export function parseLogEntries(content: string, format: LogFormat): ParsedLogEntry[] {
  const out: ParsedLogEntry[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const entry =
      format === 'pino'
        ? parsePino(line)
        : format === 'json'
          ? parseGenericJson(line)
          : parseText(line);
    if (entry && entry.level >= WARN) out.push(entry);
  }
  return out;
}
