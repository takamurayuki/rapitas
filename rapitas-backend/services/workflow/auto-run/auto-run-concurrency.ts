/**
 * auto-run-concurrency
 *
 * Resolves the global auto-run concurrency limit (env override, then the
 * UserSettings.autoRunMaxConcurrency setting) and the per-theme limit (task
 * 1552, capped by the global one), and holds the theme-priority
 * helpers used to decide which running theme takes a free slot (task 1543).
 * Not responsible for counting active items (see getGlobalAutoRunActiveCount)
 * or for enqueueing — callers act on what these helpers return.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { eligibleTopLevelTodoWhere } from './auto-run-eligibility';

export const MIN_AUTO_RUN_MAX_CONCURRENCY = 1;
export const MAX_AUTO_RUN_MAX_CONCURRENCY = 4;
export const DEFAULT_AUTO_RUN_MAX_CONCURRENCY = 1;
export const MIN_THEME_AUTO_RUN_PRIORITY = -100;
export const MAX_THEME_AUTO_RUN_PRIORITY = 100;

/**
 * How long a "refused for want of a slot" record stays valid: two ticks
 * (POLL_INTERVAL_MS = 12 s) plus slack, so the record survives until the next
 * tick re-registers it, and a paused or stopped theme stops holding others
 * back within 30 s.
 */
// NOTE: written as a literal rather than importing POLL_INTERVAL_MS —
// auto-run-selection imports this module, and the import would be circular.
export const CONCURRENCY_WAITER_TTL_MS = 2 * 12_000 + 6_000;

/** Where the effective limit came from — shown to the user when env wins. */
export type AutoRunConcurrencySource = 'env' | 'settings';

/**
 * Clamp a stored/submitted concurrency value to 1..4; anything non-numeric is 1.
 *
 * @param value - Raw value from the DB or request / DB・リクエストの生の値
 * @returns Integer in 1..4 / 1〜4 の整数
 */
export function normalizeAutoRunMaxConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_AUTO_RUN_MAX_CONCURRENCY;
  return Math.max(
    MIN_AUTO_RUN_MAX_CONCURRENCY,
    Math.min(MAX_AUTO_RUN_MAX_CONCURRENCY, Math.floor(value)),
  );
}

/**
 * Read AUTO_RUN_GLOBAL_MAX_CONCURRENCY as an override. Only a positive integer
 * counts; '', non-numeric and <= 0 mean "not set" and fall back to settings.
 *
 * @param env - Environment to read / 読み取る環境変数
 * @returns The override, or null when unset/invalid / 上書き値（未設定・不正なら null）
 */
export function parseEnvAutoRunMaxConcurrency(
  env: Record<string, string | undefined>,
): number | null {
  const raw = env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY;
  if (raw === undefined || raw.trim() === '') return null;
  const n = parseInt(raw, 10);
  // NOTE: no upper clamp — the env var never had one, and existing operation
  // must keep its meaning (only the UI setting is limited to 1..4).
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * Resolve the effective global auto-run limit for this selection.
 * Not cached: selection already reads userSettings each time, and an uncached
 * read makes a save take effect on the very next selection.
 *
 * @param prisma - Injected Prisma client / 注入された Prisma クライアント
 * @param env - Environment (injectable for tests) / 環境変数（テスト用に注入可）
 * @returns Limit and its source / 上限値とその由来
 */
export async function resolveAutoRunMaxConcurrency(
  prisma: PrismaClient,
  env: Record<string, string | undefined> = process.env,
): Promise<{ limit: number; source: AutoRunConcurrencySource }> {
  const fromEnv = parseEnvAutoRunMaxConcurrency(env);
  if (fromEnv !== null) return { limit: fromEnv, source: 'env' };
  // NOTE: no `select` — until the client is regenerated after the schema change,
  // naming the new column would fail validation and take the whole call down.
  let row: unknown = null;
  try {
    row = await prisma.userSettings.findFirst();
  } catch {
    row = null;
  }
  const value = (row as { autoRunMaxConcurrency?: unknown } | null)?.autoRunMaxConcurrency;
  return { limit: normalizeAutoRunMaxConcurrency(value), source: 'settings' };
}

/**
 * Read AUTO_RUN_THEME_MAX_CONCURRENCY (task 1552) with the same rule as the
 * global override: only a positive integer counts.
 *
 * @param env - Environment to read / 読み取る環境変数
 * @returns The override, or null when unset/invalid / 上書き値（未設定・不正なら null）
 */
export function parseEnvAutoRunMaxConcurrencyPerTheme(
  env: Record<string, string | undefined>,
): number | null {
  return parseEnvAutoRunMaxConcurrency({
    AUTO_RUN_GLOBAL_MAX_CONCURRENCY: env.AUTO_RUN_THEME_MAX_CONCURRENCY,
  });
}

/**
 * Resolve how many tasks ONE theme may run at once (task 1552): env override,
 * then UserSettings.autoRunMaxConcurrencyPerTheme clamped to 1..4, 1 when the
 * row or column cannot be read. `effective` is capped by the global limit, so
 * the global cap keeps working.
 *
 * @param prisma - Injected Prisma client / 注入された Prisma クライアント
 * @param env - Environment (injectable for tests) / 環境変数（テスト用に注入可）
 * @returns Per-theme limit, its source and the effective value / テーマ内上限・由来・実効値
 */
export async function resolveAutoRunMaxConcurrencyPerTheme(
  prisma: PrismaClient,
  env: Record<string, string | undefined> = process.env,
): Promise<{ limit: number; source: AutoRunConcurrencySource; effective: number }> {
  const global = await resolveAutoRunMaxConcurrency(prisma, env);
  const fromEnv = parseEnvAutoRunMaxConcurrencyPerTheme(env);
  let limit: number;
  let source: AutoRunConcurrencySource;
  if (fromEnv !== null) {
    limit = fromEnv;
    source = 'env';
  } else {
    // NOTE: no `select` — the column is pending client regeneration (same as above).
    let row: unknown = null;
    try {
      row = await prisma.userSettings.findFirst();
    } catch {
      row = null;
    }
    const value = (row as { autoRunMaxConcurrencyPerTheme?: unknown } | null)
      ?.autoRunMaxConcurrencyPerTheme;
    limit = normalizeAutoRunMaxConcurrency(value);
    source = 'settings';
  }
  return { limit, source, effective: Math.max(1, Math.min(limit, global.limit)) };
}

/**
 * Clamp a theme priority to -100..100; anything non-numeric is 0.
 *
 * @param value - Raw value from the DB or request / DB・リクエストの生の値
 * @returns Integer in -100..100 / -100〜100 の整数
 */
export function normalizeThemeAutoRunPriority(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(
    MIN_THEME_AUTO_RUN_PRIORITY,
    Math.min(MAX_THEME_AUTO_RUN_PRIORITY, Math.floor(value)),
  );
}

type ThemePriorityModel = {
  findMany: (args: { where: { id: { in: number[] } } }) => Promise<unknown[]>;
};

/**
 * Load autoRunPriority for the given themes. Any failure yields an empty map,
 * i.e. every theme counts as 0 and the legacy behaviour holds.
 *
 * @param prisma - Injected Prisma client / 注入された Prisma クライアント
 * @param themeIds - Themes to read / 対象テーマID
 * @returns themeId → priority / テーマID→優先度
 */
export async function loadThemeAutoRunPriorities(
  prisma: PrismaClient,
  themeIds: number[],
): Promise<Map<number, number>> {
  const priorities = new Map<number, number>();
  if (themeIds.length === 0) return priorities;
  try {
    // Cast: the column is pending client regeneration (CLAUDE.md forbids a manual generate).
    const themeModel = prisma.theme as unknown as ThemePriorityModel;
    const rows = await themeModel.findMany({ where: { id: { in: themeIds } } });
    for (const row of rows) {
      const r = row as { id?: unknown; autoRunPriority?: unknown };
      if (typeof r.id === 'number') {
        priorities.set(r.id, normalizeThemeAutoRunPriority(r.autoRunPriority));
      }
    }
  } catch {
    return new Map();
  }
  return priorities;
}

/**
 * Order running themes for one tick: higher priority first, ties by ascending
 * themeId (the DB return order was never specified, so it is fixed here).
 *
 * @param states - Running theme states / 実行中テーマの状態
 * @param priorities - themeId → priority (missing = 0) / 優先度マップ
 * @returns A new, sorted array / 並べ替えた新しい配列
 */
export function sortRunningThemesByPriority<T extends { themeId: number }>(
  states: T[],
  priorities: Map<number, number>,
): T[] {
  return [...states].sort((a, b) => {
    const diff = (priorities.get(b.themeId) ?? 0) - (priorities.get(a.themeId) ?? 0);
    return diff !== 0 ? diff : a.themeId - b.themeId;
  });
}

// Process-local on purpose: a restart just loses one tick's worth of records,
// which the next refusal re-registers.
const waiters = new Map<number, { priority: number; at: number }>();

/**
 * Record that a theme was refused only because the global limit was reached.
 * Themes with no selectable task are not recorded, so they never make a
 * lower-priority theme hold a slot open for nothing.
 *
 * @param prisma - Injected Prisma client / 注入された Prisma クライアント
 * @param themeId - Refused theme / 枠不足で断られたテーマ
 * @param now - Epoch ms (injectable for tests) / 現在時刻
 */
export async function noteConcurrencyWaiter(
  prisma: PrismaClient,
  themeId: number,
  now: number = Date.now(),
): Promise<void> {
  try {
    const eligible = await prisma.task.count({ where: eligibleTopLevelTodoWhere(themeId) });
    if (!(eligible >= 1)) return;
    const priorities = await loadThemeAutoRunPriorities(prisma, [themeId]);
    waiters.set(themeId, { priority: priorities.get(themeId) ?? 0, at: now });
  } catch {
    // A failed read must not block anyone: simply do not record.
  }
}

/**
 * Drop a theme's waiting record (it got past the limit check).
 *
 * @param themeId - Theme to clear / 記録を消すテーマ
 */
export function clearConcurrencyWaiter(themeId: number): void {
  waiters.delete(themeId);
}

/**
 * Decide whether this theme should leave a free slot to a strictly
 * higher-priority theme that was recently refused for want of one.
 *
 * @param prisma - Injected Prisma client / 注入された Prisma クライアント
 * @param themeId - Theme about to select / 選定しようとしているテーマ
 * @param now - Epoch ms (injectable for tests) / 現在時刻
 * @returns yield:true with the theme to yield to, else yield:false / 譲るかどうか
 */
export async function shouldYieldToHigherPriorityTheme(
  prisma: PrismaClient,
  themeId: number,
  now: number = Date.now(),
): Promise<{ yield: false } | { yield: true; to: number }> {
  for (const [id, w] of waiters) {
    if (now - w.at > CONCURRENCY_WAITER_TTL_MS) waiters.delete(id);
  }
  const others = [...waiters].filter(([id]) => id !== themeId);
  if (others.length === 0) return { yield: false };
  const own = (await loadThemeAutoRunPriorities(prisma, [themeId])).get(themeId) ?? 0;
  let best: { id: number; priority: number } | null = null;
  for (const [id, w] of others) {
    if (w.priority > own && (best === null || w.priority > best.priority)) {
      best = { id, priority: w.priority };
    }
  }
  return best ? { yield: true, to: best.id } : { yield: false };
}

/** Clear the waiting ledger (tests only). */
export function __resetConcurrencyWaitersForTests(): void {
  waiters.clear();
}
