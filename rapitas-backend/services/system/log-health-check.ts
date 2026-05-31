/**
 * Log Health Check
 *
 * Daily job: reads TODAY's backend warn/error log file (written by the pino
 * file sink in config/logger.ts), groups entries by a stable signature, and
 * files the distinct problems into the concern backlog. Stable titles/details
 * mean a recurring error is filed once (deduped by submitConcern), not re-added
 * every day. Also prunes log files older than the retention window.
 *
 * Not responsible for capturing logs (that's the logger) or fixing issues.
 */
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger, getBackendLogFilePath } from '../../config/logger';
import { submitConcern, type ConcernSeverity } from '../memory/concern-backlog-service';

const log = createLogger('system:log-health-check');

/** Max distinct problems filed per run (errors prioritised over warnings). */
const MAX_CONCERNS = 20;
/** Only the last N lines are scanned, to bound work on a noisy day. */
const MAX_LINES = 5_000;
/** Delete daily log files older than this many days. */
const RETENTION_DAYS = 14;

interface LogLine {
  level: number;
  time?: number;
  name?: string;
  msg?: string;
  err?: { message?: string; stack?: string };
}

interface Grouped {
  signature: string;
  level: number; // highest pino level seen for this signature
  name: string;
  normalizedMsg: string;
  sampleStack?: string;
  count: number;
}

/** pino numeric level → concern severity. */
export function levelToSeverity(level: number): ConcernSeverity {
  if (level >= 60) return 'urgent'; // fatal
  if (level >= 50) return 'high'; // error
  return 'medium'; // warn
}

/** pino numeric level → short label. */
function levelLabel(level: number): string {
  if (level >= 60) return 'FATAL';
  if (level >= 50) return 'ERROR';
  return 'WARN';
}

/**
 * Normalizes a message so volatile parts (ids, counts, hex) collapse, letting
 * "task 12 failed" and "task 34 failed" group together.
 */
function normalizeMessage(raw: string): string {
  return raw
    .replace(/0x[0-9a-fA-F]+/g, '#')
    .replace(/[0-9a-fA-F]{8,}/g, '#') // uuids / hashes
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Groups raw NDJSON log lines (warn+) by a stable signature. Pure — the
 * health check's testable core.
 *
 * @param rawLines - NDJSON log lines / NDJSONログ行
 * @returns Distinct problem groups / 問題のグループ
 */
export function groupLogLines(rawLines: string[]): Grouped[] {
  const lines = rawLines.length > MAX_LINES ? rawLines.slice(-MAX_LINES) : rawLines;

  const groups = new Map<string, Grouped>();
  for (const line of lines) {
    if (!line) continue;
    let entry: LogLine;
    try {
      entry = JSON.parse(line) as LogLine;
    } catch {
      continue; // skip non-JSON / partial lines
    }
    if (typeof entry.level !== 'number' || entry.level < 40) continue;

    const baseMsg = entry.err?.message || entry.msg || '(メッセージなし)';
    const normalizedMsg = normalizeMessage(baseMsg);
    const name = entry.name || 'app';
    const bucket = entry.level >= 50 ? 'error' : 'warn';
    const signature = `${name}|${bucket}|${normalizedMsg}`;

    const existing = groups.get(signature);
    if (existing) {
      existing.count++;
      existing.level = Math.max(existing.level, entry.level);
      if (!existing.sampleStack && entry.err?.stack) existing.sampleStack = entry.err.stack;
    } else {
      groups.set(signature, {
        signature,
        level: entry.level,
        name,
        normalizedMsg,
        sampleStack: entry.err?.stack,
        count: 1,
      });
    }
  }

  return [...groups.values()];
}

/** Reads today's log file and groups it (returns [] if the file is absent). */
function groupTodayLogs(): Grouped[] {
  const path = getBackendLogFilePath();
  if (!existsSync(path)) return [];
  try {
    return groupLogLines(readFileSync(path, 'utf-8').split('\n').filter(Boolean));
  } catch (err) {
    log.warn({ err }, 'Failed to read log file');
    return [];
  }
}

/** Deletes daily log files older than the retention window (best-effort). */
function pruneOldLogs(): void {
  const dir = join(getBackendLogFilePath(), '..');
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of files) {
    const m = file.match(/^backend-(\d{4})-(\d{2})-(\d{2})\.log$/);
    if (!m) continue;
    const fileTime = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    if (fileTime < cutoff) {
      try {
        unlinkSync(join(dir, file));
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Run the daily log health check: file today's distinct warnings/errors as
 * concerns, then prune old log files.
 *
 * @returns Number of concerns filed / 起票された懸念の数
 */
export async function runLogHealthCheck(): Promise<number> {
  log.info('Starting log health check');

  const groups = groupTodayLogs();
  if (groups.length === 0) {
    log.info('No warnings/errors in today log — backend healthy');
    pruneOldLogs();
    return 0;
  }

  // Errors before warnings; within a level, the most frequent first.
  groups.sort((a, b) => b.level - a.level || b.count - a.count);
  const top = groups.slice(0, MAX_CONCERNS);

  let filed = 0;
  for (const g of top) {
    const label = levelLabel(g.level);
    // Stable title/detail → submitConcern dedups, so a recurring error is filed
    // once rather than re-added every day.
    const title = `[ログ:${label}] ${g.normalizedMsg.slice(0, 100)}`;
    const detailParts = [
      `ロガー: ${g.name}`,
      `レベル: ${label}`,
      '',
      'バックエンドのログから検出された warning/error です。頻発する場合は原因調査を推奨します。',
    ];
    if (g.sampleStack) detailParts.push('', '例:', g.sampleStack.slice(0, 800));

    await submitConcern({
      title,
      detail: detailParts.join('\n'),
      type: g.level >= 50 ? 'bug' : 'other',
      severity: levelToSeverity(g.level),
      source: 'log_health',
    });
    filed++;
  }

  pruneOldLogs();
  log.info({ filed, distinct: groups.length }, 'Log health check complete');
  return filed;
}
