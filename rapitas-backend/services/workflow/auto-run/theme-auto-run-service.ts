/**
 * theme-auto-run-service
 *
 * CRUD + state-machine helpers for ThemeAutoRun records.
 * Manages the lifecycle of per-theme auto-execution state.
 * Does NOT contain scheduling logic — see theme-auto-run-scheduler.ts.
 */
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';
// NOTE: Direct path import (not barrel) to avoid transitive config/logger pull-in that breaks bun mock isolation.
import { makeStringTypeGuard } from '../../../utils/common/type-guards';

const log = createLogger('theme-auto-run-service');

/**
 * Runtime array of all valid auto-run status values. Derive AutoRunStatus from this
 * so the type and the runtime validation list can never drift apart.
 */
export const AUTO_RUN_STATUSES = ['idle', 'running', 'paused', 'stopping'] as const;

/** Valid status values for ThemeAutoRun.status. */
export type AutoRunStatus = (typeof AUTO_RUN_STATUSES)[number];

const autoRunStatusGuard = makeStringTypeGuard(AUTO_RUN_STATUSES);

/**
 * Narrows a DB string (or null/undefined) to AutoRunStatus, returning 'idle' as
 * the safe fallback when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @returns A valid AutoRunStatus. / 有効なAutoRunStatus
 */
export function narrowAutoRunStatus(s: string | null | undefined): AutoRunStatus {
  return autoRunStatusGuard.narrow(s, 'idle');
}

/** Serialisable view of a ThemeAutoRun record. */
export interface ThemeAutoRunState {
  id: number;
  themeId: number;
  enabled: boolean;
  status: AutoRunStatus;
  order: 'priority' | 'created';
  currentTaskId: number | null;
  processedCount: number;
  lastError: string | null;
  lastRunAt: string | null;
  startedAt: string | null;
  updatedAt: string;
}

/**
 * Return or create the ThemeAutoRun record for a theme.
 *
 * @param themeId - Theme to look up / 検索するテーマID
 * @returns ThemeAutoRun state / ThemeAutoRun状態
 */
export async function getOrCreateAutoRun(themeId: number): Promise<ThemeAutoRunState> {
  const existing = await prisma.themeAutoRun.findUnique({ where: { themeId } });
  if (existing) return mapToState(existing);

  const created = await prisma.themeAutoRun.create({
    data: { themeId },
  });
  return mapToState(created);
}

/**
 * Retrieve the auto-run state for a theme; returns null when no record exists.
 *
 * @param themeId - Theme ID / テーマID
 * @returns state or null / 状態またはnull
 */
export async function getAutoRunState(themeId: number): Promise<ThemeAutoRunState | null> {
  const record = await prisma.themeAutoRun.findUnique({ where: { themeId } });
  return record ? mapToState(record) : null;
}

/**
 * Whether a theme's auto-run is the actor currently executing `taskId`.
 *
 * When the user stops such a task, the loop must also be halted — otherwise the
 * scheduler re-selects the just-stopped task on its next poll (the "press stop,
 * it runs again" bug). True only when auto-run is actively driving THIS task.
 *
 * @param state - The theme's auto-run state (or null). / テーマのauto-run状態（またはnull）
 * @param taskId - The task being stopped. / 停止対象タスクID
 * @returns true when auto-run is currently running this task. / auto-runが当該タスクを実行中ならtrue
 */
export function isAutoRunHandlingTask(state: ThemeAutoRunState | null, taskId: number): boolean {
  if (!state) return false;
  return (
    state.currentTaskId === taskId &&
    (state.status === 'running' || state.status === 'paused' || state.status === 'stopping')
  );
}

/**
 * Start auto-run for a theme (idle → running).
 * Creates the record if it does not exist.
 * No-op if already running.
 *
 * @param themeId - Theme to start / 開始するテーマID
 * @param order - Task selection order / タスク選択順序
 * @returns updated state / 更新後の状態
 */
export async function startAutoRun(
  themeId: number,
  order?: 'priority' | 'created',
): Promise<ThemeAutoRunState> {
  const existing = await prisma.themeAutoRun.findUnique({ where: { themeId } });

  if (existing?.status === 'running') {
    log.warn(`[ThemeAutoRunService] Theme ${themeId} is already running`);
    return mapToState(existing);
  }

  const updated = await prisma.themeAutoRun.upsert({
    where: { themeId },
    create: {
      themeId,
      enabled: true,
      status: 'running',
      order: order ?? 'priority',
      startedAt: new Date(),
    },
    update: {
      enabled: true,
      status: 'running',
      order: order ?? existing?.order ?? 'priority',
      startedAt: new Date(),
      lastError: null,
      // Keep processedCount to track total across restarts
    },
  });

  log.info(`[ThemeAutoRunService] Started auto-run for theme ${themeId}`);
  return mapToState(updated);
}

/**
 * Pause auto-run for a theme (running → paused).
 * The current in-flight task is allowed to complete naturally.
 *
 * @param themeId - Theme to pause / 一時停止するテーマID
 * @returns updated state / 更新後の状態
 */
export async function pauseAutoRun(themeId: number): Promise<ThemeAutoRunState> {
  const updated = await prisma.themeAutoRun.upsert({
    where: { themeId },
    create: { themeId, status: 'paused' },
    update: { status: 'paused' },
  });
  log.info(`[ThemeAutoRunService] Paused auto-run for theme ${themeId}`);
  return mapToState(updated);
}

/**
 * Resume a paused theme (paused → running).
 * Used when plan approval is granted while the theme was waiting.
 *
 * @param themeId - Theme to resume / 再開するテーマID
 * @returns updated state or null if theme not found / 更新後の状態またはnull
 */
export async function resumeAutoRun(themeId: number): Promise<ThemeAutoRunState | null> {
  const existing = await prisma.themeAutoRun.findUnique({ where: { themeId } });
  if (!existing) return null;
  if (existing.status !== 'paused') return mapToState(existing);

  const updated = await prisma.themeAutoRun.update({
    where: { themeId },
    data: { status: 'running' },
  });
  log.info(`[ThemeAutoRunService] Resumed auto-run for theme ${themeId}`);
  return mapToState(updated);
}

/**
 * Signal that auto-run should stop (running → stopping).
 * The scheduler processes this signal on next tick and performs cleanup.
 *
 * @param themeId - Theme to stop / 停止するテーマID
 * @returns updated state / 更新後の状態
 */
export async function stopAutoRun(themeId: number): Promise<ThemeAutoRunState> {
  const updated = await prisma.themeAutoRun.upsert({
    where: { themeId },
    create: { themeId, status: 'idle' },
    update: { status: 'stopping' },
  });
  log.info(`[ThemeAutoRunService] Stopping auto-run for theme ${themeId}`);
  return mapToState(updated);
}

/**
 * Immediately set theme status to idle and clear current task.
 * Called by the scheduler after completing a stop operation.
 *
 * @param themeId - Theme ID / テーマID
 */
export async function finalizeStop(themeId: number): Promise<void> {
  await prisma.themeAutoRun.updateMany({
    where: { themeId },
    data: { status: 'idle', enabled: false, currentTaskId: null },
  });
}

/**
 * Update the current task being executed and increment processedCount.
 *
 * @param themeId - Theme ID / テーマID
 * @param taskId - New current task ID / 新しいカレントタスクID
 */
export async function setCurrentTask(themeId: number, taskId: number): Promise<void> {
  await prisma.themeAutoRun.updateMany({
    where: { themeId },
    data: { currentTaskId: taskId, lastRunAt: new Date(), lastError: null },
  });
}

/**
 * Mark the current task as completed and pick the next one.
 * Increments processedCount and clears currentTaskId.
 *
 * @param themeId - Theme ID / テーマID
 */
export async function onTaskCompleted(themeId: number): Promise<void> {
  await prisma.themeAutoRun.updateMany({
    where: { themeId },
    data: { currentTaskId: null, processedCount: { increment: 1 } },
  });
}

/**
 * Record a task failure and mark for skip; increment processedCount.
 *
 * @param themeId - Theme ID / テーマID
 * @param error - Error message / エラーメッセージ
 */
export async function onTaskFailed(themeId: number, error: string): Promise<void> {
  await prisma.themeAutoRun.updateMany({
    where: { themeId },
    data: { currentTaskId: null, processedCount: { increment: 1 }, lastError: error },
  });
}

/**
 * Mark a queue item as waiting for plan approval (running → paused).
 *
 * @param themeId - Theme ID / テーマID
 */
export async function onAwaitingPlanApproval(themeId: number): Promise<void> {
  await prisma.themeAutoRun.updateMany({
    where: { themeId, status: 'running' },
    data: { status: 'paused' },
  });
  log.info(`[ThemeAutoRunService] Theme ${themeId} paused — awaiting plan approval`);
}

/**
 * Return true when the theme has an active auto-run (running or paused).
 * Used by the execute-route to block manual execution.
 *
 * @param themeId - Theme ID / テーマID
 * @returns true if auto-run is active / 自動実行がアクティブならtrue
 */
export async function isThemeAutoRunActive(themeId: number | null | undefined): Promise<boolean> {
  if (!themeId) return false;
  const record = await prisma.themeAutoRun.findUnique({
    where: { themeId },
    select: { status: true },
  });
  return record?.status === 'running' || record?.status === 'paused';
}

/**
 * Return all ThemeAutoRun records whose status matches any of the given values.
 *
 * @param statuses - Status values to include / 含めるステータス
 * @returns matching records / 一致するレコード
 */
export async function findByStatuses(statuses: AutoRunStatus[]): Promise<ThemeAutoRunState[]> {
  const records = await prisma.themeAutoRun.findMany({
    where: { status: { in: statuses } },
  });
  return records.map(mapToState);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mapToState(r: {
  id: number;
  themeId: number;
  enabled: boolean;
  status: string;
  order: string;
  currentTaskId: number | null;
  processedCount: number;
  lastError: string | null;
  lastRunAt: Date | null;
  startedAt: Date | null;
  updatedAt: Date;
}): ThemeAutoRunState {
  return {
    id: r.id,
    themeId: r.themeId,
    enabled: r.enabled,
    status: narrowAutoRunStatus(r.status),
    order: r.order as 'priority' | 'created',
    currentTaskId: r.currentTaskId,
    processedCount: r.processedCount,
    lastError: r.lastError,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    startedAt: r.startedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}
