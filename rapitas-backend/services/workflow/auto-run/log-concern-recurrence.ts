/**
 * LogConcernRecurrence
 *
 * Decides whether a concern the log-health check filed is still happening,
 * so the backlog promoter can retire a stale one instead of spending three
 * agent phases to conclude "修正不要". Responsible only for the recurrence
 * question; filing, promotion and resolution stay with their own modules.
 *
 * Measured 2026-08-30: of 7 no-change completions in 12 hours, 5 were
 * log-derived tasks chasing the same resolved outage — the 08-28 Prisma
 * column mismatch — split across loggers into separate signatures. Each ran
 * research, implementation and verification to find nothing to do.
 */
import { existsSync } from 'node:fs';
import { getBackendLogFilePath } from '../../../config/logger';
import { normalizeMessage, readGlobalEntries } from '../../system/log-health-check';
import type { ParsedLogEntry } from '../../system/log-format-parser';

/** How far back a signature must have recurred to still count as live. */
export const RECURRENCE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The title length the filer keeps of the normalised message (see fileGroupedConcerns). */
const TITLE_FRAGMENT_MAX = 100;

/**
 * The normalised-message fragment a log-health concern title carries.
 *
 * Titles are built as `[ログ:LEVEL] (project) <normalizedMsg.slice(0, 100)>`;
 * the project label is optional and the message is truncated, so the
 * fragment is a prefix of the normalised message, never the whole thing.
 *
 * @param title - Concern title. / 懸念タイトル
 * @returns The fragment, or null when the title is not a log-health one. / 断片（ログ由来でなければ null）
 */
export function fragmentFromLogConcernTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = title.match(/^\[ログ:(?:FATAL|ERROR|WARN)\]\s*(?:\([^)]*\)\s*)?(.*)$/s);
  if (!m) return null;
  const fragment = m[1].trim();
  return fragment.length > 0 ? fragment : null;
}

/**
 * Whether any entry's normalised message matches the fragment.
 *
 * @param fragment - Prefix kept in the concern title. / タイトル中の断片
 * @param entries - Parsed log entries to scan. / 走査対象のログ
 * @returns true when at least one entry matches. / 一致があれば true
 */
export function fragmentRecursIn(fragment: string, entries: ParsedLogEntry[]): boolean {
  for (const e of entries) {
    if (e.level < 40) continue;
    const normalized = normalizeMessage(e.msg || '');
    if (normalized.length >= TITLE_FRAGMENT_MAX) {
      if (normalized.startsWith(fragment)) return true;
    } else if (normalized === fragment) {
      return true;
    }
  }
  return false;
}

/**
 * Entries from today's and yesterday's backend log on or after sinceMs.
 *
 * Throws when neither file exists: silence in logs that were never written
 * is not evidence that a signature stopped, and the caller fails open on it.
 */
async function readRecentEntries(sinceMs: number, nowMs: number): Promise<ParsedLogEntry[]> {
  const today = new Date(nowMs);
  const yesterday = new Date(nowMs - 24 * 60 * 60 * 1000);
  const stamp = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const paths = [
    getBackendLogFilePath(stamp(yesterday)),
    getBackendLogFilePath(stamp(today)),
  ].filter((p) => existsSync(p));
  if (paths.length === 0) throw new Error('no backend log file for the recurrence window');
  const all: ParsedLogEntry[] = [];
  for (const p of paths) {
    all.push(...(await readGlobalEntries(sinceMs, p)));
  }
  return all;
}

/**
 * Whether a log-health concern's signature still appears in recent logs.
 *
 * Fails OPEN: when the title carries no fragment or the logs cannot be read,
 * the answer is null and the caller promotes as it always has. Only a
 * definite "no occurrence in the window" retires a concern.
 *
 * @param concern - The concern's title. / 懸念（タイトル）
 * @param opts.nowMs - Current time (ms), injected for tests. / 現在時刻
 * @param opts.readEntries - Log reader override for tests. / ログ読み取りの差し替え
 * @returns true = still recurring, false = silent for the window, null = unknown. / 再発中 / 沈黙 / 不明
 */
export async function isLogConcernStillRecurring(
  concern: { title: string | null | undefined },
  opts: {
    nowMs?: number;
    readEntries?: (sinceMs: number, nowMs: number) => Promise<ParsedLogEntry[]>;
  } = {},
): Promise<boolean | null> {
  const fragment = fragmentFromLogConcernTitle(concern.title);
  if (!fragment) return null;
  const nowMs = opts.nowMs ?? Date.now();
  try {
    const entries = await (opts.readEntries ?? readRecentEntries)(
      nowMs - RECURRENCE_WINDOW_MS,
      nowMs,
    );
    return fragmentRecursIn(fragment, entries);
  } catch {
    return null;
  }
}
