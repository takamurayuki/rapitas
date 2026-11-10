/**
 * session-cost-sweep
 *
 * Background pass over EVERY AgentSession that re-derives its totals from the
 * usage rows and repairs the ones that disagree, in paced batches started
 * after a delay so the boot is not slowed. It is the second stage behind the
 * window-bounded startup recovery (session-cost-recovery.ts): a session whose
 * deferred retry kept failing at its read never had its updatedAt bumped, and
 * after a long enough outage plus a restart it fell outside that window
 * (re-review3 P2). Not responsible for the recompute itself
 * (session-cost-totals.ts).
 */
import { createLogger } from '../../config/logger';
import {
  readTotals,
  recomputeSessionTotals,
  scheduleSessionRecompute,
  type SessionTotalsDb,
} from './session-cost-totals';

const log = createLogger('agents:session-cost-sweep');

/** Sessions read per batch. */
const DEFAULT_BATCH_SIZE = 50;
/** Pause between batches, so the sweep never competes for the DB in bursts. */
const DEFAULT_PAUSE_MS = 2_000;
/** First backoff after a failed page read (doubles, capped at RETRY_MAX_MS). */
const DEFAULT_RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 60_000;
/** Delay after boot before the first batch, so the warm-up is not slowed. */
export const SWEEP_START_DELAY_MS = 60_000;

/** A session's stored totals, as the recovery and the sweep read them. */
export interface StoredSessionTotals {
  id: number;
  totalCostUsd: unknown;
  totalTokensUsed: number;
}

/** The AgentSession page read the sweep needs (structural, so tests can pass fakes). */
export interface SessionSweepDb {
  agentSession: {
    findMany(args: {
      where: { id: { gt: number } };
      orderBy: { id: 'asc' };
      take: number;
      select: { id: true; totalCostUsd: true; totalTokensUsed: true };
    }): Promise<StoredSessionTotals[]>;
  };
}

/** Pacing and cancellation of a sweep. */
export interface SweepOptions {
  batchSize?: number;
  pauseMs?: number;
  retryBaseMs?: number;
  signal?: AbortSignal;
}

/** Outcome of a sweep; `completed` is false when it was stopped first. */
export interface SweepResult {
  checked: number;
  repaired: number;
  deferred: number;
  completed: boolean;
}

/**
 * Compare a session's stored totals with its usage rows and rewrite (verified)
 * them if they differ. Any failure hands the session to the deferred retry,
 * so a transient error never leaves it stale (re-review3 P2). Never throws.
 *
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param s - The session's stored totals / 保存済みの合計
 * @returns 'ok' (already right), 'repaired' or 'deferred' / 結果
 */
export async function repairSessionIfStale(
  db: SessionTotalsDb,
  s: StoredSessionTotals,
): Promise<'ok' | 'repaired' | 'deferred'> {
  try {
    const want = await readTotals(db, s.id);
    // Matching sessions are not written, so their updatedAt stays put.
    if (Number(s.totalCostUsd) === want.totalCostUsd && s.totalTokensUsed === want.totalTokensUsed) {
      return 'ok';
    }
    // A false result means the verification was deferred (already scheduled).
    return (await recomputeSessionTotals(db, s.id)) ? 'repaired' : 'deferred';
  } catch (err) {
    // recomputeSessionTotals schedules its own retry before throwing; this
    // covers the comparison read, which fails before reaching it. The queue
    // coalesces per session, so scheduling twice is harmless.
    log.warn({ err, sessionId: s.id }, '[session-cost] Repair failed; deferred retry scheduled');
    scheduleSessionRecompute(db, s.id);
    return 'deferred';
  }
}

/** Resolve after `ms`, or as soon as `signal` aborts; the timer never holds the process. */
const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    (t as { unref?: () => void }).unref?.();
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

/**
 * Walk every session by id, batch by batch, repairing stale totals. A failed
 * page read is retried from the same cursor with backoff (never skipped), so
 * the sweep only ends by reaching the last session or by `signal`.
 *
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param opts - Batch size, pacing and cancellation / バッチ件数・間隔・中断
 * @returns Counts, and whether every session was read / 件数と完走したか
 */
export async function sweepAllSessionTotals(
  db: SessionTotalsDb & SessionSweepDb,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const take = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const retryBase = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const res: SweepResult = { checked: 0, repaired: 0, deferred: 0, completed: false };
  let cursor = 0;
  let failures = 0;
  while (!opts.signal?.aborted) {
    let page: StoredSessionTotals[];
    try {
      page = await db.agentSession.findMany({
        where: { id: { gt: cursor } },
        orderBy: { id: 'asc' },
        take,
        select: { id: true, totalCostUsd: true, totalTokensUsed: true },
      });
      failures = 0;
    } catch (err) {
      log.warn({ err, cursor }, '[session-cost] Sweep page read failed; retrying');
      await pause(Math.min(retryBase * 2 ** failures++, RETRY_MAX_MS), opts.signal);
      continue;
    }
    if (page.length === 0) {
      res.completed = true;
      break;
    }
    for (const s of page) {
      if (opts.signal?.aborted) break;
      const outcome = await repairSessionIfStale(db, s);
      res.checked++;
      if (outcome === 'repaired') res.repaired++;
      if (outcome === 'deferred') res.deferred++;
      cursor = s.id;
    }
    await pause(opts.pauseMs ?? DEFAULT_PAUSE_MS, opts.signal);
  }
  return res;
}

/** Handle of a background sweep. */
export interface SweepHandle {
  /** Settles when the sweep completes or is stopped; never rejects. */
  done: Promise<SweepResult>;
  stop(): void;
}

let current: SweepHandle | undefined;

/**
 * Start {@link sweepAllSessionTotals} in the background after `delayMs`,
 * replacing (stopping) any sweep already running. Returns at once.
 *
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param opts - Sweep options plus the start delay / 走査の設定と開始までの遅延
 * @returns The handle; also stopped by {@link stopBackgroundSessionSweep} / ハンドル
 */
export function startBackgroundSessionSweep(
  db: SessionTotalsDb & SessionSweepDb,
  opts: SweepOptions & { delayMs?: number } = {},
): SweepHandle {
  current?.stop();
  const ac = new AbortController();
  const done = (async (): Promise<SweepResult> => {
    await pause(opts.delayMs ?? SWEEP_START_DELAY_MS, ac.signal);
    const res = await sweepAllSessionTotals(db, { ...opts, signal: ac.signal });
    if (res.completed) log.info(res, '[session-cost] Background sweep of session totals done');
    return res;
  })().catch((err): SweepResult => {
    log.warn({ err }, '[session-cost] Background sweep failed');
    return { checked: 0, repaired: 0, deferred: 0, completed: false };
  });
  const handle: SweepHandle = { done, stop: () => ac.abort() };
  current = handle;
  void done.then(() => {
    if (current === handle) current = undefined;
  });
  return handle;
}

/** Stop the running background sweep, if any (shutdown, before the DB closes). */
export function stopBackgroundSessionSweep(): void {
  current?.stop();
}
