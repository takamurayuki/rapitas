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
 *
 * The position is persisted after every session (session-cost-sweep-cursor.ts)
 * and the walk wraps at the last id, so boots that each end early still move
 * it forward and reach every session (re-review4 P2). Once stopped it issues
 * no further DB call, and the shutdown drain waits for the stage in flight.
 */
import { createLogger } from '../../config/logger';
import {
  readTotals,
  recomputeSessionTotals,
  scheduleSessionRecompute,
  type SessionTotalsDb,
} from './session-cost-totals';
import { createFileSweepCursorStore, type SweepCursorStore } from './session-cost-sweep-cursor';

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
      where: { id: { gt: number; lte?: number } };
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
  /** Where the position survives restarts; defaults to the data-dir file. */
  cursorStore?: SweepCursorStore;
}

/** Outcome of a sweep; `completed` is false when it was stopped first. */
export interface SweepResult {
  checked: number;
  repaired: number;
  deferred: number;
  completed: boolean;
}

class SweepStopped extends Error {}

/** `db` whose comparison reads refuse to start once `signal` has aborted. */
function stopAwareReads(db: SessionTotalsDb, signal: AbortSignal): SessionTotalsDb {
  const guard = () => {
    if (signal.aborted) throw new SweepStopped('session sweep stopped');
  };
  return {
    ...db,
    agentExecution: {
      findMany: async (args) => {
        guard();
        return db.agentExecution.findMany(args);
      },
    },
    agentAction: {
      findMany: async (args) => {
        guard();
        return db.agentAction.findMany(args);
      },
    },
  };
}

/**
 * Compare a session's stored totals with its usage rows and rewrite (verified)
 * them if they differ. Any failure before the stop hands the session to the
 * deferred retry, so a transient error never leaves it stale (re-review3 P2).
 * Never throws.
 *
 * With `signal`, the stop is checked before each comparison read and again
 * before the recompute; a stopped repair touches the DB no further and
 * returns 'stopped' (the persisted cursor has not passed it, so the next boot
 * redoes it). So does a read that fails after the stop: it is not queued for
 * retry, since an interruption is not a failure (re-review5 P2). A recompute
 * already started is finished, since it writes and then verifies; the
 * shutdown drain waits for it (re-review4 P2).
 *
 * @param db - Prisma client (or a structural fake) / Prisma クライアント
 * @param s - The session's stored totals / 保存済みの合計
 * @param signal - Stop of the sweep / 走査の停止
 * @returns 'ok' (already right), 'repaired', 'deferred' or 'stopped' / 結果
 */
export async function repairSessionIfStale(
  db: SessionTotalsDb,
  s: StoredSessionTotals,
  signal?: AbortSignal,
): Promise<'ok' | 'repaired' | 'deferred' | 'stopped'> {
  if (signal?.aborted) return 'stopped';
  try {
    const want = await readTotals(signal ? stopAwareReads(db, signal) : db, s.id);
    if (signal?.aborted) return 'stopped';
    // Matching sessions are not written, so their updatedAt stays put.
    if (
      Number(s.totalCostUsd) === want.totalCostUsd &&
      s.totalTokensUsed === want.totalTokensUsed
    ) {
      return 'ok';
    }
    // A false result means the verification was deferred (already scheduled).
    return (await recomputeSessionTotals(db, s.id)) ? 'repaired' : 'deferred';
  } catch (err) {
    if (err instanceof SweepStopped) return 'stopped';
    // NOTE: A read that was in flight at the stop and then failed is an
    // interruption, not a failure: queueing it would let the shutdown drain
    // (or the queue's timer) start a recompute after the stop (re-review5 P2).
    // The cursor has not passed it, so the next sweep redoes it. A recompute
    // already started has scheduled its own retry before throwing.
    if (signal?.aborted) {
      log.debug(
        { err, sessionId: s.id },
        '[session-cost] Repair interrupted by the stop; left to the next sweep',
      );
      return 'stopped';
    }
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
 * the sweep only ends by completing a lap or by `signal`.
 *
 * A lap starts after the persisted cursor, runs to the last id, then wraps to
 * the start and ends at the cursor it began from; the cursor is saved after
 * every finished session and reset to 0 when the lap completes.
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
  const store = opts.cursorStore ?? createFileSweepCursorStore();
  const res: SweepResult = { checked: 0, repaired: 0, deferred: 0, completed: false };
  const start = store.read();
  let cursor = start;
  // Starting at 0 the first pass is already the whole lap.
  let wrapped = start === 0;
  let failures = 0;
  while (!opts.signal?.aborted) {
    let page: StoredSessionTotals[];
    try {
      page = await db.agentSession.findMany({
        where: { id: wrapped && start > 0 ? { gt: cursor, lte: start } : { gt: cursor } },
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
      if (!wrapped) {
        wrapped = true;
        cursor = 0;
        store.write(0);
        continue;
      }
      store.write(0);
      res.completed = true;
      break;
    }
    for (const s of page) {
      const outcome = await repairSessionIfStale(db, s, opts.signal);
      if (outcome === 'stopped') break;
      res.checked++;
      if (outcome === 'repaired') res.repaired++;
      if (outcome === 'deferred') res.deferred++;
      cursor = s.id;
      store.write(cursor);
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

/**
 * Stop the running background sweep, if any (shutdown, before the DB closes).
 *
 * @returns Settles once the stage in flight has finished and the sweep issues no more DB calls / 進行中の段が終わり、DB に触らなくなったら解決する
 */
export function stopBackgroundSessionSweep(): Promise<void> {
  const running = current;
  running?.stop();
  return running ? running.done.then(() => undefined) : Promise.resolve();
}
