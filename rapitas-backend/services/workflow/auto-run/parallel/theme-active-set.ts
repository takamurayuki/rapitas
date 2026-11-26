/**
 * theme-active-set
 *
 * Reads and writes a theme's running set (task 1552): the head
 * (ThemeAutoRun.currentTaskId) plus companion tasks (companionTasksJson).
 * Every slot release goes through here so a completed or stopped task frees
 * only its own slot. 単独実行も対象タスクIDを条件に解放する。
 * Not responsible for choosing companions (see companion-selection).
 */
import type { PrismaClient } from '../../../../generated/prisma-postgres';
import { createLogger } from '../../../../config/logger';
// NOTE: namespace import on purpose — tests mock theme-auto-run-service with
// only the functions they use, and a named import of a missing one fails at load.
import * as service from '../theme-auto-run-service';
import type { ThemeActiveSet } from './parallel-types';
import { parseCompanions, serializeCompanions, isValidCompanionJson } from './companion-json';

const log = createLogger('theme-active-set');

/** Optimistic-lock retries before a write gives up. */
export const MAX_CAS_ATTEMPTS = 3;

type LooseModel = {
  findFirst?: (args: unknown) => Promise<unknown>;
  findMany?: (args: unknown) => Promise<unknown>;
  updateMany?: (args: unknown) => Promise<unknown>;
};

// Cast: companionTasksJson is pending client regeneration (CLAUDE.md forbids a
// manual generate), and test doubles often lack themeAutoRun entirely.
export function model(prisma: PrismaClient): LooseModel {
  return (prisma as unknown as { themeAutoRun?: LooseModel }).themeAutoRun ?? {};
}

/**
 * Compare-and-set write on ThemeAutoRun (shared with theme-active-set-cleanup).
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param where - CAS condition / 条件
 * @param data - Values / 値
 * @returns Whether a row was updated / 更新できたか
 */
export async function casUpdate(
  prisma: PrismaClient,
  where: object,
  data: object,
): Promise<boolean> {
  const m = model(prisma);
  if (typeof m.updateMany !== 'function') return false;
  const res = (await m.updateMany({ where, data })) as { count?: number } | undefined;
  return (res?.count ?? 0) > 0;
}

// Pure JSON helpers live in companion-json.ts (no DB imports) and are re-exported.
export { parseCompanions, serializeCompanions } from './companion-json';

/**
 * Read a theme's running set. A failed read (old client, missing model) is
 * "no companions" so callers fall back to one-at-a-time.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme / テーマID
 * @returns Running set / 動作中集合
 */
export async function readThemeActiveSet(
  prisma: PrismaClient,
  themeId: number,
): Promise<ThemeActiveSet> {
  const empty: ThemeActiveSet = { headTaskId: null, companions: [], raw: null, readable: false };
  const m = model(prisma);
  if (typeof m.findFirst !== 'function') return empty;
  let row: unknown;
  try {
    // NOTE: no `select` — naming the pending column would fail on an old client.
    row = await m.findFirst({ where: { themeId } });
  } catch {
    return empty;
  }
  if (!row || typeof row !== 'object') return empty;
  const r = row as { currentTaskId?: unknown; companionTasksJson?: unknown };
  const headTaskId = typeof r.currentTaskId === 'number' ? r.currentTaskId : null;
  const raw = typeof r.companionTasksJson === 'string' ? r.companionTasksJson : null;
  const readable = 'companionTasksJson' in r && isValidCompanionJson(r.companionTasksJson);
  if ('companionTasksJson' in r && !readable)
    log.warn({ themeId }, '同伴JSONが破損しているため並列追加を拒否する');
  const companions = readable ? parseCompanions(raw).filter((c) => c.taskId !== headTaskId) : [];
  return {
    headTaskId,
    companions,
    raw,
    readable,
  };
}

/** 終端・削除済みのタスクを掃除して動作中集合を読む。失敗時は枠を保持する。 */
export async function loadThemeActiveSet(
  prisma: PrismaClient,
  themeId: number,
): Promise<ThemeActiveSet> {
  const set = await readThemeActiveSet(prisma, themeId);
  const ids = activeTaskIds(set);
  if (!set.readable || ids.length === 0 || typeof prisma.task?.findMany !== 'function') return set;
  try {
    const tasks = await prisma.task.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    });
    for (const taskId of ids) {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status === 'done' || task.status === 'cancelled') {
        await releaseThemeSlot(
          prisma,
          themeId,
          taskId,
          task?.status === 'done' ? 'completed' : 'released',
        );
      }
    }
    return await readThemeActiveSet(prisma, themeId);
  } catch (err) {
    log.warn({ err, themeId }, '同伴の終端確認に失敗したため枠を保持する');
    return set;
  }
}

/**
 * Every task id holding a slot: head first, then companions.
 *
 * @param set - Running set / 動作中集合
 * @returns Task ids / タスクID
 */
export function activeTaskIds(set: ThemeActiveSet): number[] {
  const ids = set.companions.map((c) => c.taskId);
  return set.headTaskId != null ? [set.headTaskId, ...ids] : ids;
}

/**
 * Add a companion with a compare-and-set on the JSON read, while the theme is
 * running. Returns false when the column is unwritable (old client) or the
 * write kept losing races.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme / テーマID
 * @param taskId - Task to add / 追加するタスク
 * @param now - Tenure origin (epoch ms) / 在籍開始時刻
 * @returns Whether the task now holds a companion slot / 追加できたか
 */
export async function addCompanion(
  prisma: PrismaClient,
  themeId: number,
  taskId: number,
  now: number = Date.now(),
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const set = await loadThemeActiveSet(prisma, themeId);
    if (!set.readable) return false;
    if (activeTaskIds(set).includes(taskId)) return true;
    const next = serializeCompanions([...set.companions, { taskId, since: now }]);
    try {
      const where = { themeId, status: 'running', companionTasksJson: set.raw };
      if (await casUpdate(prisma, where, { companionTasksJson: next })) return true;
    } catch (err) {
      log.warn({ err, themeId, taskId }, 'companion add failed — staying one at a time');
      return false;
    }
  }
  return false;
}

/** How a task leaves its slot. */
export type SlotReleaseKind = 'completed' | 'failed' | 'released';

/** What a release did. */
export type SlotReleaseOutcome = 'head_removed' | 'promoted' | 'companion_removed' | 'not_member';

function bookkeeping(kind: SlotReleaseKind, error?: string): object {
  if (kind === 'released') return {};
  return {
    processedCount: { increment: 1 },
    ...(kind === 'failed' ? { lastError: error ?? '' } : {}),
  };
}

/**
 * 対象IDと読取時のJSONをCAS条件にして、そのタスクだけを解放する。
 * 同伴が残る場合は最古の同伴を在籍時刻を保って繰り上げる。
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme / テーマID
 * @param taskId - Task leaving its slot / 枠を離れるタスク
 * @param kind - completed / failed / released / 解放の種類
 * @param error - Error for a failure / 失敗時のエラー
 * @returns What was done / 実施内容
 */
export async function releaseThemeSlot(
  prisma: PrismaClient,
  themeId: number,
  taskId: number,
  kind: SlotReleaseKind,
  error?: string,
  throwOnError = false,
  expectedStatus?: string,
): Promise<SlotReleaseOutcome> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const set = await readThemeActiveSet(prisma, themeId);
    try {
      if (set.headTaskId === taskId || !set.readable) {
        const [next, ...rest] = set.companions;
        const data = {
          currentTaskId: next?.taskId ?? null,
          ...(next
            ? { lastRunAt: new Date(next.since) }
            : kind === 'released'
              ? { lastRunAt: new Date(), lastError: null }
              : {}),
          ...(set.readable ? { companionTasksJson: serializeCompanions(rest) } : {}),
          ...bookkeeping(kind, error),
          ...(expectedStatus ? { status: 'running' } : {}),
        };
        const where = {
          themeId,
          currentTaskId: taskId,
          ...(set.readable ? { companionTasksJson: set.raw } : {}),
          ...(expectedStatus ? { status: { in: [expectedStatus] } } : {}),
        };
        if (await casUpdate(prisma, where, data)) return next ? 'promoted' : 'head_removed';
      } else if (!expectedStatus && set.companions.some((c) => c.taskId === taskId)) {
        const rest = set.companions.filter((c) => c.taskId !== taskId);
        const data = { companionTasksJson: serializeCompanions(rest), ...bookkeeping(kind, error) };
        if (await casUpdate(prisma, { themeId, companionTasksJson: set.raw }, data)) {
          return 'companion_removed';
        }
      } else {
        return 'not_member';
      }
    } catch (err) {
      if (throwOnError) throw err;
      log.warn({ err, themeId, taskId }, 'slot release write failed — retrying');
    }
  }
  log.warn({ themeId, taskId }, 'slot release lost every compare-and-set race');
  return 'not_member';
}

/**
 * Keep a task in its slot and restart its tenure clock (the pre-task
 * setCurrentTask(themeId, taskId) for the head; `since = now` for a companion).
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme / テーマID
 * @param taskId - Task to re-track / 追跡し直すタスク
 */
export async function retrackThemeSlot(
  prisma: PrismaClient,
  themeId: number,
  taskId: number,
): Promise<void> {
  const set = await loadThemeActiveSet(prisma, themeId);
  const companion = set.companions.some((c) => c.taskId === taskId);
  if (!companion) {
    if (set.companions.length === 0 || set.headTaskId === taskId) {
      await service.setCurrentTask(themeId, taskId);
    }
    return;
  }
  const next = set.companions.map((c) => (c.taskId === taskId ? { taskId, since: Date.now() } : c));
  await casUpdate(
    prisma,
    { themeId, companionTasksJson: set.raw },
    { companionTasksJson: serializeCompanions(next) },
  ).catch((err) => log.warn({ err, themeId, taskId }, 'companion re-track failed'));
}
