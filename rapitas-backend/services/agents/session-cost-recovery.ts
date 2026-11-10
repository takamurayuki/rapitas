/**
 * session-cost-recovery
 *
 * Closes the restart gap of session-cost-totals' deferred retry, which lives
 * in process memory: at startup it re-derives the totals of recently written
 * sessions from their usage rows, and at shutdown it drains pending retries
 * within a time budget. Not responsible for the recompute itself (see
 * session-cost-totals.ts) and needs no schema change (re-re-review P2).
 */
import { createLogger } from '../../config/logger';
import {
  readTotals,
  recomputeSessionTotals,
  flushPendingSessionRecomputes,
  type SessionTotalsDb,
} from './session-cost-totals';

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
 * pending time with a wide margin.
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
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param opts.bootTime - Start of the current process; writes after it belong to this run / 現プロセスの起動時刻
 * @param opts.windowMs - Override of RECOVERY_WINDOW_MS (tests) / 対象期間の上書き
 * @returns Sessions checked and repaired / 確認したセッション数と修復した数
 */
export async function recoverSessionTotals(
  db: SessionTotalsDb & SessionRecoveryDb,
  opts: { bootTime: Date; windowMs?: number },
): Promise<{ checked: number; repaired: number }> {
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
    try {
      const want = await readTotals(db, s.id);
      if (
        Number(s.totalCostUsd) === want.totalCostUsd &&
        s.totalTokensUsed === want.totalTokensUsed
      ) {
        continue;
      }
      repaired++;
      // Verified write; a failure here leaves a deferred retry (session-cost-totals).
      await recomputeSessionTotals(db, s.id);
    } catch (err) {
      log.warn({ err, sessionId: s.id }, '[session-cost] Startup recovery of a session failed');
    }
  }
  return { checked: sessions.length, repaired };
}

/**
 * Boot-time entry of {@link recoverSessionTotals} on the shared Prisma client.
 * Never throws: a failure is logged and the next boot tries again.
 *
 * @returns Sessions repaired (0 on failure) / 修復したセッション数（失敗時は 0）
 */
export async function recoverSessionTotalsOnBoot(): Promise<number> {
  try {
    // Lazy so importing this module (tests, shutdown hooks) does not open the DB.
    const { prisma } = await import('../../config/database');
    // Process start, so writes by this run (incl. the worker process) are excluded from the anchor.
    const bootTime = new Date(Date.now() - process.uptime() * 1000);
    const res = await recoverSessionTotals(
      prisma as unknown as SessionTotalsDb & SessionRecoveryDb,
      { bootTime },
    );
    if (res.repaired > 0) log.info(res, '[session-cost] Startup recovery repaired session totals');
    return res.repaired;
  } catch (err) {
    log.warn({ err }, '[session-cost] Startup recovery of session totals failed');
    return 0;
  }
}

/**
 * Run pending deferred recomputes before the process exits, giving up after
 * `timeoutMs` so a dead DB cannot hold the shutdown. Never throws.
 *
 * @param opts.timeoutMs - Time budget of the drain / 待つ上限（ミリ秒）
 */
export async function drainSessionRecomputesForShutdown(opts: {
  timeoutMs: number;
}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), opts.timeoutMs);
  });
  try {
    const outcome = await Promise.race([
      flushPendingSessionRecomputes(SHUTDOWN_MAX_ROUNDS).then(() => 'done' as const),
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
