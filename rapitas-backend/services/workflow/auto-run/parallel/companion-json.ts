/**
 * companion-json
 *
 * Reads and writes ThemeAutoRun.companionTasksJson (task 1552) without any
 * database or service import, so read-only callers (task cards, status API,
 * diagnostics) can parse it without loading the scheduler graph.
 * Not responsible for writing the column.
 */
import { createLogger } from '../../../../config/logger';
import type { CompanionSlot } from './parallel-types';

const log = createLogger('theme-active-set');

/** 空集合と破損データを区別し、破損時の並列追加を拒否する。 */
export function isValidCompanionJson(raw: unknown): boolean {
  if (raw === null) return true;
  if (typeof raw !== 'string') return false;
  try {
    const value: unknown = JSON.parse(raw);
    return (
      Array.isArray(value) &&
      value.every((item: unknown) => {
        if (!item || typeof item !== 'object') return false;
        const row = item as { taskId?: unknown; since?: unknown };
        return (
          typeof row.taskId === 'number' &&
          Number.isSafeInteger(row.taskId) &&
          row.taskId > 0 &&
          typeof row.since === 'number' &&
          Number.isFinite(row.since)
        );
      })
    );
  } catch {
    return false;
  }
}

/**
 * Parse companionTasksJson; anything malformed reads as no companions.
 *
 * @param raw - Column value / 列の値
 * @returns Companions, oldest first, without duplicates / 同伴タスク（古い順）
 */
export function parseCompanions(raw: unknown): CompanionSlot[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn({ raw: raw.slice(0, 200) }, 'companionTasksJson is not JSON — treated as empty');
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<number>();
  const out: CompanionSlot[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const r = item as { taskId?: unknown; since?: unknown };
    if (typeof r.taskId !== 'number' || !Number.isSafeInteger(r.taskId) || seen.has(r.taskId)) {
      continue;
    }
    seen.add(r.taskId);
    out.push({ taskId: r.taskId, since: typeof r.since === 'number' ? r.since : Date.now() });
  }
  return out.sort((a, b) => a.since - b.since);
}

/**
 * Serialize companions; an empty list is NULL.
 *
 * @param list - Companions / 同伴タスク
 * @returns Column value / 列の値
 */
export function serializeCompanions(list: CompanionSlot[]): string | null {
  return list.length === 0
    ? null
    : JSON.stringify(list.map((c) => ({ taskId: c.taskId, since: c.since })));
}
