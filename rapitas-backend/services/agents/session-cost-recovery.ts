/**
 * session-cost-recovery
 *
 * Closes the restart gap of session-cost-totals' deferred retry, which lives
 * in process memory: at startup it re-derives the totals of recently written
 * sessions from their usage rows, and at shutdown it drains pending retries
 * within a time budget. Not responsible for the recompute itself (see
 * session-cost-totals.ts) and needs no schema change (re-re-review P2).
 *
 * Boot recovery has two stages (re-review3 P2): the window below is repaired
 * at once, in the warm-up; every session — including ones the window cannot
 * reach — is then read by the delayed, paced background sweep
 * (session-cost-sweep.ts). No failure is only logged: a session whose read
 * fails goes to the deferred recompute, a failed session-list read reruns
 * the whole window recovery.
 */
import { createLogger } from '../../config/logger';
import { flushPendingSessionRecomputes, type SessionTotalsDb } from './session-cost-totals';
import { createKeyedRetryQueue } from './keyed-retry-queue';
import {
  repairSessionIfStale,
  startBackgroundSessionSweep,
  stopBackgroundSessionSweep,
  type SessionSweepDb,
  type SweepHandle,
  type SweepOptions,
} from './session-cost-sweep';

const log = createLogger('agents:session-cost-recovery');

/**
 * How far before the last pre-boot session write startup recovery looks.
 *
 * Why this bounds the stale sessions: a stale total is left only by a totals
 * write whose verification had not succeeded when the process ended, and
 * every totals write bumps AgentSession.updatedAt (Prisma @updatedAt). So a
 * stale session was written no earlier than "end of the previous run minus
 * how long its retry was pending", and the newest pre-boot write is no later
 * than that end. Retries back off to 30 s, so a day covers any realistic
 * pending time with a wide margin. A retry that fails for longer than this
 * (its write is never reached, so updatedAt never moves) is not covered by
 * the window — the background sweep reads it instead.
 */
export const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Rounds of retries the shutdown drain attempts at most. */
const SHUTDOWN_MAX_ROUNDS = 20;

/** The extra AgentSession reads recovery needs (structural, so tests can pass fakes). */
export interface SessionRecoveryDb {
  agentSession: {
    findFirst(args: {
      where: { updatedAt: { lt: Date } };
      orderBy: { updatedAt: 'desc' };
      select: { updatedAt: true };
    }): Promise<{ updatedAt: Date } | null>;
    findMany(args: {
      where: { updatedAt: { gte: Date } };
      orderBy: { id: 'asc' };
      select: { id: true; totalCostUsd: true; totalTokensUsed: true };
    }): Promise<Array<{ id: number; totalCostUsd: unknown; totalTokensUsed: number }>>;
  };
}

/** Reruns of a window recovery whose session-list read failed (one key: the boot). */
const recoveryRuns = createKeyedRetryQueue<'window'>({
  baseMs: 1_000,
  maxMs: 60_000,
  onError: (_k, err) =>
    log.warn({ err }, '[session-cost] Startup recovery rerun failed; retrying'),
});

type RecoveryDb = SessionTotalsDb & SessionRecoveryDb;
type RecoveryOpts = { bootTime: Date; windowMs?: number };

/** One pass over the window; throws only when the session list cannot be read. */
async function recoverWindow(db: RecoveryDb, opts: RecoveryOpts) {
  const latest = await db.agentSession.findFirst({
    where: { updatedAt: { lt: opts.bootTime } },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  });
  if (!latest) return { checked: 0, repaired: 0 };
  const from = new Date(latest.updatedAt.getTime() - (opts.windowMs ?? RECOVERY_WINDOW_MS));
  const sessions = await db.agentSession.findMany({
    where: { updatedAt: { gte: from } },
    orderBy: { id: 'asc' },
    select: { id: true, totalCostUsd: true, totalTokensUsed: true },
  });
  let repaired = 0;
  for (const s of sessions) {
    // Never throws; a failed read or write leaves a deferred retry (re-review3 P2).
    if ((await repairSessionIfStale(db, s)) !== 'ok') repaired++;
  }
  return { checked: sessions.length, repaired };
}

/**
 * Re-derive the totals of every session written within RECOVERY_WINDOW_MS of
 * the last session write before `bootTime`, and rewrite (verified) the ones
 * that disagree with their usage rows. Sessions that already agree are not
 * written, so their updatedAt — and the next boot's window — is left alone.
 *
 * The window is anchored on the last pre-boot write, not on `bootTime`, so a
 * long downtime (a desktop left off for days) does not push the stale
 * sessions out of it.
 *
 * Never throws: a session that fails is handed to the deferred recompute,
 * and a failed session-list read schedules a rerun of the whole pass.
 *
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param opts.bootTime - Start of the current process; writes after it belong to this run / 現プロセスの起動時刻
 * @param opts.windowMs - Override of RECOVERY_WINDOW_MS (tests) / 対象期間の上書き
 * @returns Sessions checked and repaired or deferred (0/0 when rerun later) / 確認した数と修復（再試行を含む）した数
 */
export async function recoverSessionTotals(
  db: RecoveryDb,
  opts: RecoveryOpts,
): Promise<{ checked: number; repaired: number }> {
  try {
    return await recoverWindow(db, opts);
  } catch (err) {
    log.warn({ err }, '[session-cost] Startup recovery could not list sessions; rerun scheduled');
    recoveryRuns.schedule('window', async () => {
      await recoverWindow(db, opts);
      return false;
    });
    return { checked: 0, repaired: 0 };
  }
}

/**
 * Run a pending rerun of the window recovery now (tests, diagnostics).
 *
 * @param maxRounds - Upper bound of rerun rounds / 再実行の最大ラウンド数
 */
export async function flushPendingRecoveryRuns(maxRounds?: number): Promise<void> {
  await recoveryRuns.flush(maxRounds);
}

/**
 * Number of window recoveries waiting for a rerun (0 or 1).
 *
 * @returns Pending rerun count / 再実行待ちの数
 */
export function pendingRecoveryRunCount(): number {
  return recoveryRuns.size();
}

/**
 * Both boot stages: repair the window now (awaited), then start the full
 * background sweep, which waits `sweep.delayMs` before reading anything.
 *
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param opts.bootTime - Start of the current process / 現プロセスの起動時刻
 * @param opts.sweep - Background sweep options / 背景走査の設定
 * @returns Window result and the sweep handle / 期間内の結果と背景走査のハンドル
 */
export async function runBootRecovery(
  db: RecoveryDb & SessionSweepDb,
  opts: RecoveryOpts & { sweep?: SweepOptions & { delayMs?: number } },
): Promise<{ checked: number; repaired: number; sweep: SweepHandle }> {
  const res = await recoverSessionTotals(db, opts);
  return { ...res, sweep: startBackgroundSessionSweep(db, opts.sweep) };
}

/**
 * Boot-time entry of {@link runBootRecovery} on the shared Prisma client.
 * Never throws; the background sweep keeps running after this returns.
 *
 * @returns Sessions repaired (0 on failure) / 修復したセッション数（失敗時は 0）
 */
export async function recoverSessionTotalsOnBoot(): Promise<number> {
  try {
    // Lazy so importing this module (tests, shutdown hooks) does not open the DB.
    const { prisma } = await import('../../config/database');
    // Process start, so writes by this run (incl. the worker process) are excluded from the anchor.
    const bootTime = new Date(Date.now() - process.uptime() * 1000);
    const { checked, repaired } = await runBootRecovery(
      prisma as unknown as RecoveryDb & SessionSweepDb,
      { bootTime },
    );
    if (repaired > 0) {
      log.info({ checked, repaired }, '[session-cost] Startup recovery repaired session totals');
    }
    return repaired;
  } catch (err) {
    log.warn({ err }, '[session-cost] Startup recovery of session totals failed');
    return 0;
  }
}

/**
 * Stop the background sweep and wait for its stage in flight, then run
 * pending deferred recomputes before the process exits, giving up after
 * `timeoutMs` (shared by both) so a dead DB cannot hold the shutdown.
 * Never throws.
 *
 * @param opts.timeoutMs - Time budget of the drain / 待つ上限（ミリ秒）
 */
export async function drainSessionRecomputesForShutdown(opts: {
  timeoutMs: number;
}): Promise<void> {
  // The sweep must not query a DB about to be disconnected, so its stage in
  // flight is awaited (within the budget) before the drain; the next boot
  // resumes it from the persisted cursor (re-review4 P2).
  const sweepStopped = stopBackgroundSessionSweep();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // NOTE: Promise.race does not cancel the losing continuation, so the
  // decision to start the flush (and each further flush round) is made
  // against this flag, inside the budget: once it has run out, nothing new
  // touches the DB after the drain returns (re-review5 P2). A recompute
  // already in flight still finishes; cutting it would leave a write unverified.
  let expired = false;
  const budget = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve('timeout');
    }, opts.timeoutMs);
  });
  try {
    const outcome = await Promise.race([
      sweepStopped
        // Checked before the first round too, so a late stop starts no flush.
        .then(() => flushPendingSessionRecomputes(SHUTDOWN_MAX_ROUNDS, () => expired))
        .then(() => 'done' as const),
      budget,
    ]);
    if (outcome === 'timeout') {
      log.warn('[session-cost] Shutdown drain timed out; startup recovery will repair the rest');
    }
  } catch (err) {
    log.warn({ err }, '[session-cost] Shutdown drain failed; startup recovery will repair it');
  } finally {
    clearTimeout(timer);
  }
}
