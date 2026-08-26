/**
 * Log Health Check
 *
 * Daily job. Extracts today's warning/error log entries and files the distinct
 * problems into the concern backlog. Two sources:
 *   1. Global — rapitas's own backend log (the pino file sink in config/logger.ts).
 *   2. Per-project — for each theme that opted in (ThemeBacklogSchedule
 *      health_check with a logDir + format), scans that project's logs.
 * Stable titles/details mean a recurring error is filed once (deduped by
 * submitConcern), not re-added every day. Also prunes the global log files.
 *
 * Not responsible for capturing logs (the logger / each project does) or fixing.
 */
import { readFile } from 'fs/promises';
import { classifyLogSignature } from './log-health-suppressions';
import { readdirSync, statSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger, getBackendLogFilePath } from '../../config/logger';
import { prisma } from '../../config/database';
import {
  submitConcern,
  resolveDefaultThemeId,
  type ConcernSeverity,
} from '../memory/concern-backlog-service';
import {
  getHealthCheckTargets,
  type LogFormat,
} from '../scheduling/theme-backlog-override-service';
import { parseLogEntries, type ParsedLogEntry } from './log-format-parser';

const log = createLogger('system:log-health-check');

/** Max distinct problems filed per source per run (errors prioritised). */
const MAX_CONCERNS = 20;
/** Only the last N lines of a file are scanned, to bound work on a noisy day. */
const MAX_LINES = 5_000;
/** Max files scanned per project log directory. */
const MAX_FILES_PER_THEME = 20;
/** Max parsed entries kept per project, to bound memory/work. */
const MAX_ENTRIES_PER_THEME = 4_000;
/** Delete daily backend log files older than this many days. */
const RETENTION_DAYS = 14;

interface Grouped {
  signature: string;
  level: number; // highest level seen for this signature
  name: string;
  normalizedMsg: string;
  sampleStack?: string;
  count: number;
}

/** Numeric level → concern severity. */
export function levelToSeverity(level: number): ConcernSeverity {
  if (level >= 60) return 'urgent'; // fatal
  if (level >= 50) return 'high'; // error
  return 'medium'; // warn
}

/** Numeric level → short label. */
function levelLabel(level: number): string {
  if (level >= 60) return 'FATAL';
  if (level >= 50) return 'ERROR';
  return 'WARN';
}

/** Start of the local day in epoch ms. */
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * A canonical 8-4-4-4-12 UUID. Must be collapsed as ONE unit before the
 * generic hex/digit rules below: those only fold hex runs of 8+ chars and pure
 * digit runs, so a UUID's 4-char middle segments survive with a per-value
 * letter pattern ("...-6e3b-40bd-..." → "-#e#b-#bd-" vs "-c#-#-b#a-"). That
 * made one recurring failure produce a different signature — and therefore a
 * NEW concern and task — on every occurrence, because the dedup key is built
 * from this output. Measured 2026-08-18: six byte-identical
 * "Claude CLI exited" tasks filed from a single repeating cause.
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * A JSON payload embedded in a message — collapsed whole, nesting included.
 * Greedy to the LAST brace on purpose: CLI payloads nest, and a non-greedy
 * match left the outer object open, so two reports of one failure still looked
 * different.
 */
const JSON_BLOB_RE = /\{["'].*\}/gs;

/** Windows or POSIX absolute path, collapsed so the same defect in two trees groups. */
const ABS_PATH_RE = new RegExp(
  String.raw`(?:[A-Za-z]:[\\\\/][^\s,;)"']*|/(?:home|Users|var|tmp)/[^\s,;)"']*)`,
  'g',
);

/**
 * Normalizes a message so volatile parts (ids, counts, hex) collapse, letting
 * "task 12 failed" and "task 34 failed" group together.
 */
function normalizeMessage(raw: string): string {
  return (
    raw
      .replace(UUID_RE, '#') // whole UUIDs first — see UUID_RE
      // A JSON payload carries the whole variable state of a failure. Left in,
      // one repeating cause becomes a new signature per occurrence: measured
      // 2026-08-27, four byte-identical 「Claude CLI exited」 concerns sat open
      // together, and a fifth truncated before the payload made a fifth.
      .replace(JSON_BLOB_RE, '{…}')
      // Absolute paths make the SAME defect in two worktrees (or two projects)
      // dedupe as two: 'setup-worktree.cjs not found at <A>' and '… at <B>'
      // were both open at once, as were two 'git worktree remove' failures.
      .replace(ABS_PATH_RE, '<path>')
      .replace(/0x[0-9a-fA-F]+/g, '#')
      .replace(/[0-9a-fA-F]{8,}/g, '#') // hashes / bare hex ids
      .replace(/\d+/g, '#')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  );
}

/**
 * Groups parsed warn+ entries by a stable signature. Pure — the health check's
 * testable core.
 *
 * @param entries - Parsed log entries / 解析済みエントリ
 * @returns Distinct problem groups / 問題のグループ
 */
export function groupEntries(entries: ParsedLogEntry[]): Grouped[] {
  const groups = new Map<string, Grouped>();
  for (const entry of entries) {
    if (entry.level < 40) continue;
    const normalizedMsg = normalizeMessage(entry.msg || '(メッセージなし)');
    const name = entry.name || 'app';
    const bucket = entry.level >= 50 ? 'error' : 'warn';
    const signature = `${name}|${bucket}|${normalizedMsg}`;

    // A guard that refused, a recovery that succeeded, a fail-open that
    // continued — alarming wording, nothing left broken. Filing them buried the
    // real defects: 60 of 121 open concerns came from this path and almost none
    // named anything to fix (measured 2026-08-27).
    const verdict = classifyLogSignature(name, normalizedMsg);
    if (verdict.suppressed) {
      log.debug({ name, normalizedMsg, because: verdict.because }, '[log-health] suppressed');
      continue;
    }

    const existing = groups.get(signature);
    if (existing) {
      existing.count++;
      existing.level = Math.max(existing.level, entry.level);
      if (!existing.sampleStack && entry.stack) existing.sampleStack = entry.stack;
    } else {
      groups.set(signature, {
        signature,
        level: entry.level,
        name,
        normalizedMsg,
        sampleStack: entry.stack,
        count: 1,
      });
    }
  }
  return [...groups.values()];
}

/** Files grouped problems as concerns (stable title/detail → deduped). */
async function fileGroupedConcerns(
  groups: Grouped[],
  opts: { themeId?: number; projectLabel?: string },
): Promise<number> {
  groups.sort((a, b) => b.level - a.level || b.count - a.count);
  const top = groups.slice(0, MAX_CONCERNS);

  let filed = 0;
  for (const g of top) {
    const label = levelLabel(g.level);
    const prefix = opts.projectLabel ? `(${opts.projectLabel}) ` : '';
    const title = `[ログ:${label}] ${prefix}${g.normalizedMsg.slice(0, 100)}`;
    const detailParts = [
      `ロガー: ${g.name}`,
      `レベル: ${label}`,
      opts.projectLabel ? `プロジェクト: ${opts.projectLabel}` : 'ソース: rapitas バックエンド',
      '',
      'ログから検出された warning/error です。頻発する場合は原因調査を推奨します。',
    ];
    if (g.sampleStack) detailParts.push('', '例:', g.sampleStack.slice(0, 800));

    await submitConcern({
      title,
      detail: detailParts.join('\n'),
      type: g.level >= 50 ? 'bug' : 'other',
      severity: levelToSeverity(g.level),
      themeId: opts.themeId,
      source: 'log_health',
      // Dedup on the stable group signature (logger|bucket|normalizedMsg) scoped
      // by project — NOT title+detail, which drift between runs via the sample
      // stack and the max level (label). Keeps one concern per recurring cause.
      dedupKey: `log:${opts.projectLabel ?? 'backend'}|${g.signature}`,
    });
    filed++;
  }
  return filed;
}

/**
 * Reads + parses rapitas's own backend log, filtered to entries on or after sinceMs.
 *
 * @param sinceMs - Epoch ms lower bound; entries with time < sinceMs are dropped
 * @param filePath - Override log file path (test injection only)
 * @returns Filtered parsed entries / フィルタ済みエントリ
 */
export async function readGlobalEntries(
  sinceMs: number,
  filePath?: string,
): Promise<ParsedLogEntry[]> {
  const path = filePath ?? getBackendLogFilePath();
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, 'utf-8');
    const lines = raw.split('\n');
    const content = (lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines).join('\n');
    return parseLogEntries(content, 'pino').filter(
      (e) => e.time === undefined || e.time >= sinceMs,
    );
  } catch (err) {
    log.warn({ err }, 'Failed to read backend log file');
    return [];
  }
}

/**
 * Reads today's log files in a project's directory and parses them.
 *
 * @param dir - Log directory path / ログディレクトリパス
 * @param format - Log format / ログフォーマット
 * @returns Parsed entries for today / 今日のエントリ
 */
async function readThemeEntries(dir: string, format: LogFormat): Promise<ParsedLogEntry[]> {
  if (!existsSync(dir)) {
    log.warn({ dir }, 'Project log directory missing — skipping');
    return [];
  }
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch (err) {
    log.warn({ err, dir }, 'Failed to read project log directory');
    return [];
  }

  const since = startOfTodayMs();
  const entries: ParsedLogEntry[] = [];
  let scanned = 0;
  for (const file of files) {
    if (scanned >= MAX_FILES_PER_THEME || entries.length >= MAX_ENTRIES_PER_THEME) break;
    const full = join(dir, file);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile() || st.mtimeMs < since) continue; // only files written today
    scanned++;
    let content: string;
    try {
      content = await readFile(full, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    const trimmed = (lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines).join('\n');
    // When entries carry a timestamp, keep only today's; text logs (no time)
    // are already bounded by the file's mtime.
    const parsed = parseLogEntries(trimmed, format).filter(
      (e) => e.time === undefined || e.time >= since,
    );
    entries.push(...parsed);
  }
  return entries.slice(0, MAX_ENTRIES_PER_THEME);
}

/** Deletes daily backend log files older than the retention window. */
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
 * Run the daily log health check across rapitas's backend log and every opted-in
 * project's logs, filing distinct problems as concerns; then prune old logs.
 * Global and per-project sources run in parallel for faster completion.
 *
 * @param since - Only process entries on or after this time (defaults to start of today)
 * @returns Number of concerns filed / 起票された懸念の数
 */
export async function runLogHealthCheck(since?: Date): Promise<number> {
  log.info('Starting log health check');

  // NOTE: Clamp the window to today's start — prevents reading old data when
  // since is a prior day's lastRunAt (daily job; diff value is future-use only).
  const sinceMs = Math.max(startOfTodayMs(), since?.getTime() ?? 0);

  // Prefetch DB lookups sequentially before launching parallel I/O.
  const defaultThemeId = await resolveDefaultThemeId();
  if (defaultThemeId === null) {
    log.warn(
      'No default theme set — global backend-log concerns stay theme-less and will be hidden from the category-filtered task list',
    );
  }

  const targets = await getHealthCheckTargets();
  let nameById = new Map<number, string>();
  if (targets.length > 0) {
    const themes = await prisma.theme.findMany({
      where: { id: { in: targets.map((t) => t.themeId) } },
      select: { id: true, name: true },
    });
    nameById = new Map(themes.map((t) => [t.id, t.name]));
  }

  // 1. Global: rapitas's own backend. Attribute to the default theme so the
  // resulting concerns (and any task created from them) are theme-scoped.
  const globalTask = (async () => {
    const entries = await readGlobalEntries(sinceMs);
    return fileGroupedConcerns(groupEntries(entries), {
      themeId: defaultThemeId ?? undefined,
    });
  })();

  // 2. Per-project: each opted-in theme runs concurrently with the global task.
  const themeTasks = targets.map((target) =>
    (async () => {
      try {
        const entries = await readThemeEntries(target.logDir, target.logFormat);
        return fileGroupedConcerns(groupEntries(entries), {
          themeId: target.themeId,
          projectLabel: nameById.get(target.themeId) ?? `theme#${target.themeId}`,
        });
      } catch (err) {
        log.warn({ err, themeId: target.themeId }, 'Project log scan failed (non-fatal)');
        return 0;
      }
    })(),
  );

  const results = await Promise.all([globalTask, ...themeTasks]);
  const filed = results.reduce((sum, n) => sum + n, 0);

  pruneOldLogs();
  log.info({ filed, projects: targets.length }, 'Log health check complete');
  return filed;
}
