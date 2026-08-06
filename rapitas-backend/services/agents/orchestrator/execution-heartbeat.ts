/**
 * execution-heartbeat
 *
 * Lease writer for AgentExecution rows: while an execution is live in this
 * process, its heartbeatAt is refreshed on an interval. Dead-run detection
 * then reduces to "heartbeat older than the stale threshold" — no timestamp
 * origin comparisons, no cross-process IPC (see execution-owner.ts).
 * Not responsible for sweeping dead leases — see stale-execution-recovery.ts.
 */
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../../../config';
import { EXECUTION_OWNER_ID } from '../execution-owner';

const logger = createLogger('execution-heartbeat');

/** Refresh cadence. Must be comfortably below LEASE_STALE_MS. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/**
 * A running/pending row whose heartbeat is older than this is dead — six
 * missed beats, generous enough for GC pauses and DB hiccups.
 */
export const LEASE_STALE_MS = 90_000;

const timers = new Map<number, NodeJS.Timeout>();

/**
 * Start refreshing the lease for an execution (idempotent per id).
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param executionId - Execution row to keep alive / 対象実行ID
 */
export function startExecutionHeartbeat(prisma: PrismaClient, executionId: number): void {
  if (timers.has(executionId)) return;
  const beat = async () => {
    try {
      await prisma.agentExecution.update({
        where: { id: executionId },
        data: { heartbeatAt: new Date(), ownerId: EXECUTION_OWNER_ID },
      });
    } catch (error) {
      // Fail-soft: a missed beat only matters if it persists past the stale
      // threshold, at which point the sweeper interrupting the row is the
      // CORRECT outcome for a process that can no longer reach the DB.
      logger.warn({ err: error, executionId }, 'Heartbeat write failed');
    }
  };
  timers.set(
    executionId,
    setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS),
  );
  void beat(); // establish the lease immediately, not one interval later
}

/**
 * Stop refreshing the lease (idempotent). Call from the execution's finally.
 *
 * @param executionId - Execution row to release / 解放する実行ID
 */
export function stopExecutionHeartbeat(executionId: number): void {
  const timer = timers.get(executionId);
  if (timer) {
    clearInterval(timer);
    timers.delete(executionId);
  }
}
