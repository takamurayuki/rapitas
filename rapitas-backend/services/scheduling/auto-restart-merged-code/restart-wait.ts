/**
 * RestartWait
 *
 * Runtime side of the "restart wait": when merged code has waited too long (or
 * touches the Prisma schema) auto-run stops starting new work, the running work
 * drains, the restart gate then passes, and the themes are brought back after
 * the restart (restart-resume.ts). Running executions are never stopped.
 * Not responsible for the restart itself (index.ts) nor for the pure start
 * decision (boundary-policy.ts).
 */
import { createLogger } from '../../../config/logger';
import { logCycleEvent } from '../../observability/cycle-event-logger';
import {
  RESTART_WAIT_MAX_MS,
  RESTART_WAIT_POLL_MS,
  decideRestartWaitStart,
  resolveRestartMinIntervalMs,
} from './boundary-policy';
import {
  readRestartWaitState,
  writeRestartWaitState,
  type RestartWaitState,
} from './restart-wait-store';
import { withRestartGate } from './restart-gate';

const log = createLogger('auto-restart-restart-wait');

// Cached start time of the active wait: dequeue, task selection and phase
// hand-over all ask on hot paths. undefined = not loaded yet, null = no wait.
let cachedWaitStartedAt: number | null | undefined;
let pollTimer: ReturnType<typeof setInterval> | null = null;
// A wait inherited from before a restart belongs to restart-resume, which
// restores the themes first; ticks of this process must not end it early.
let waitBeganInThisProcess = false;

function loadWaitStartedAt(): number | null {
  if (cachedWaitStartedAt === undefined) {
    const state = readRestartWaitState();
    // Only a fully written wait holds work back: `collecting` (died mid-way) and
    // phase-less legacy data never do.
    cachedWaitStartedAt = state.phase === 'waiting' ? (state.waitStartedAt ?? null) : null;
  }
  return cachedWaitStartedAt;
}

/**
 * Whether new work must not start right now.
 *
 * A wait older than RESTART_WAIT_MAX_MS no longer counts, so a wait that can
 * never resolve cannot freeze dispatch for good.
 *
 * @param now - Clock override for tests / 現在時刻（テスト用）
 * @returns True while a restart wait is in force / 再起動待ち中ならtrue
 */
export function isRestartWaitActive(now: number = Date.now()): boolean {
  const startedAt = loadWaitStartedAt();
  return startedAt !== null && now - startedAt < RESTART_WAIT_MAX_MS;
}

/**
 * Epoch ms the active wait began, or null.
 *
 * @returns Start time of the wait / 再起動待ちの開始時刻
 */
export function getRestartWaitStartedAt(): number | null {
  return isRestartWaitActive() ? loadWaitStartedAt() : null;
}

/** Forget the cached state (tests, and after the file is rewritten elsewhere). */
export function resetRestartWaitCache(): void {
  cachedWaitStartedAt = undefined;
  waitBeganInThisProcess = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function listRunningThemeIdsFromDb(): Promise<number[]> {
  // Lazy: callers on hot paths (dequeue, phase hand-over) import this module only for
  // isRestartWaitActive and must not pull a database client in with it.
  const { prisma } = await import('../../../config/database');
  const rows = await prisma.themeAutoRun.findMany({
    where: { enabled: true, status: 'running' },
    select: { themeId: true },
  });
  return rows.map((r) => r.themeId);
}

/**
 * End the wait: new work may start again. Writes the cycle-log end record with
 * how long the wait lasted and discards the saved theme set. Idempotent.
 *
 * @param reason - Why it ended (nothing-ahead | timeout | restarted) / 終了理由
 * @param now - Clock override for tests / 現在時刻（テスト用）
 */
export function endRestartWait(
  reason: string,
  now: number = Date.now(),
  remainingState?: RestartWaitState,
): boolean {
  const startedAt = loadWaitStartedAt();
  if (startedAt === null && remainingState === undefined) return true;
  // Advances refused during this wait: taken before the state is cleared, replayed after.
  const deferred = readRestartWaitState().deferredAdvance;
  // retry集合も解除と同時に保存する。途中の空状態を作らない。
  if (
    !writeRestartWaitState(
      remainingState ?? (deferred?.length ? { phase: 'retry', deferredAdvance: deferred } : {}),
    )
  )
    return false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  waitBeganInThisProcess = false;
  cachedWaitStartedAt = null;
  if (startedAt === null) return true;
  const waitedMs = Math.max(0, now - startedAt);
  logCycleEvent('restart.wait_ended', { reason, waitedMs });
  log.info({ reason, waitedMs }, '[RestartWait] Restart wait ended');
  // After a restart the restore replays them once the themes are back (restart-resume.ts).
  if (reason !== 'restarted' && deferred?.length) {
    // 現在の排他区間を抜けてから復元する。完了前に保存集合を消さない。
    // NOTE: Dynamic import — deferred-advance → guarded-start → restart-wait would
    // otherwise form an import cycle (check-import-graph).
    setTimeout(() => {
      void import('./deferred-advance').then(({ replayDeferredAdvances }) =>
        replayDeferredAdvances(deferred, undefined, true),
      );
    }, 0);
  }
  return true;
}

/**
 * End a wait that outlived RESTART_WAIT_MAX_MS: dispatch resumes and the saved
 * theme set is discarded (themes never stopped, so there is nothing to restore).
 *
 * @param now - Clock override for tests / 現在時刻（テスト用）
 * @returns True when a stale wait was ended / 期限切れの待ちを終了したか
 */
export function expireRestartWaitIfStale(now: number = Date.now()): boolean {
  const startedAt = loadWaitStartedAt();
  if (startedAt === null || now - startedAt < RESTART_WAIT_MAX_MS) return false;
  endRestartWait('timeout', now);
  return true;
}

/**
 * 呼び出し元がrestart-gateを保持する。入れ子でロックを取り直さない。
 * The theme set is gathered under
 * `phase=collecting` (a crash here restores nothing), then the flag, the phase
 * `waiting` and the set are written in ONE atomic replace.
 *
 * @returns False when the themes could not be listed and no wait began / 開始したか
 */
async function beginWait(
  reason: string,
  aheadCount: number,
  now: number,
  listRunning?: () => Promise<number[]>,
): Promise<boolean> {
  const began = await (async () => {
    const state = readRestartWaitState();
    if (state.phase === 'waiting' || state.phase === 'retry') return false;
    if (!writeRestartWaitState({ aheadSinceAt: state.aheadSinceAt, phase: 'collecting' }))
      return false;
    let ids: number[];
    try {
      ids = await (listRunning ?? listRunningThemeIdsFromDb)();
    } catch (err) {
      // Without the set a restore could not bring the themes back: do not stop work at all.
      log.warn({ err }, '[RestartWait] Could not collect the themes to resume — not waiting');
      writeRestartWaitState({ aheadSinceAt: state.aheadSinceAt });
      return false;
    }
    if (
      !writeRestartWaitState({
        aheadSinceAt: state.aheadSinceAt,
        waitStartedAt: now,
        phase: 'waiting',
        resumeThemeIds: ids.length > 0 ? ids : undefined,
      })
    )
      return false;
    cachedWaitStartedAt = now;
    waitBeganInThisProcess = true;
    return true;
  })();
  if (!began) return false;
  logCycleEvent('restart.wait_started', { reason, aheadCount });
  log.info(
    { reason, aheadCount },
    '[RestartWait] No new work will start until merged code activates',
  );
  return true;
}

function ensurePollTimer(evaluate: () => Promise<unknown>): void {
  if (pollTimer) return;
  // Shorter than the 15 min poller: otherwise the restart would idle for up to
  // 15 min after the last running execution ended.
  pollTimer = setInterval(() => {
    if (expireRestartWaitIfStale()) return;
    evaluate().catch((err) => log.warn({ err }, '[RestartWait] Restart evaluation failed'));
  }, RESTART_WAIT_POLL_MS);
  pollTimer.unref?.();
}

/** Inputs for one restart-wait evaluation. */
export interface RestartWaitTickInput {
  /** Commits ahead of the running commit. */
  aheadCount: number;
  /** Changed paths of the pending merge (used to spot a schema change). */
  changedPaths: readonly string[];
  /** Epoch ms of the last automatic restart, or 0 when none. */
  lastRestartAt: number;
  /** Re-runs the boundary restart gate (called while waiting). */
  evaluate: () => Promise<unknown>;
  /** Theme ids to bring back after the restart (defaults to the database). */
  listRunningThemeIds?: () => Promise<number[]>;
  now?: number;
}

/**
 * One evaluation of the restart wait: track how long merged code has waited,
 * enter the wait when the policy says so, end it when nothing is ahead.
 *
 * @param input - Evaluation inputs / 評価入力
 */
export async function tickRestartWait(input: RestartWaitTickInput): Promise<void> {
  // 起点更新・開始判定も同じ区間に含め、並行tickの古い状態による上書きを防ぐ。
  await withRestartGate(() => tickRestartWaitUnderGate(input));
}

async function tickRestartWaitUnderGate(input: RestartWaitTickInput): Promise<void> {
  const now = input.now ?? Date.now();
  if (input.aheadCount <= 0) {
    if (waitBeganInThisProcess) endRestartWait('nothing-ahead', now);
    const state = readRestartWaitState();
    if (state.aheadSinceAt !== undefined) {
      writeRestartWaitState({ ...state, aheadSinceAt: undefined });
    }
    return;
  }
  const state = readRestartWaitState();
  // Never overwrite: the origin of the 30 min must survive repeated ticks.
  const aheadSinceAt = state.aheadSinceAt ?? now;
  if (state.aheadSinceAt === undefined) writeRestartWaitState({ ...state, aheadSinceAt });

  if (isRestartWaitActive(now)) {
    if (waitBeganInThisProcess) ensurePollTimer(input.evaluate);
    return;
  }
  const base = {
    aheadCount: input.aheadCount,
    aheadSinceAt,
    now,
    msSinceLastRestart: input.lastRestartAt === 0 ? null : now - input.lastRestartAt,
    minRestartIntervalMs: resolveRestartMinIntervalMs(),
  };
  const decision = decideRestartWaitStart({ ...base, changedPaths: input.changedPaths });
  if (!decision.start) return;
  if (await beginWait(decision.reason, input.aheadCount, now, input.listRunningThemeIds)) {
    ensurePollTimer(input.evaluate);
  }
}
