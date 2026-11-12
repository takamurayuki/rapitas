/**
 * jury-review-run-recovery
 *
 * Reclaims JuryReviewRun rows whose process died, so a dead review never
 * leaves Task.juryRunId set and the criteria frozen for good (companion design
 * 4.5.1). Two passes, the same shapes as the execution lease:
 *  - at startup: `running` rows whose heartbeat is older than this boot
 *    (stale-execution-recovery.ts);
 *  - while running: every 60 s, `running` rows whose heartbeat is older than
 *    90 s, except runs alive in this process (execution-lease-sweep.ts).
 * A reclaimed run becomes `abandoned` and only ITS lock is cleared. No verdict
 * is applied; the task's own state is left to the execution recovery.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { JURY_RUN_STALE_MS, finishJuryRun, liveJuryRunIds } from './jury-review-run';

const log = createLogger('workflow:jury-review-run-recovery');

/** Periodic sweep cadence (execution-lease-sweep.ts). */
export const JURY_RUN_SWEEP_INTERVAL_MS = 60_000;

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Reclaim running runs whose heartbeat is older than `before`.
 *
 * @param before - Heartbeat cut-off / この時刻より古い heartbeat が対象
 * @param reason - Why, recorded on the run / 回収の理由
 * @returns Number of runs reclaimed / 回収した件数
 */
export async function reclaimJuryRuns(before: Date, reason: string): Promise<number> {
  const live = liveJuryRunIds();
  const dead = await prisma.juryReviewRun.findMany({
    where: { status: 'running', heartbeatAt: { lt: before }, id: { notIn: live } },
    select: { id: true, taskId: true, heartbeatAt: true, ownerId: true },
  });
  for (const run of dead) {
    await finishJuryRun(run, {
      status: 'abandoned',
      discardReason: {
        reason,
        ownerId: run.ownerId,
        heartbeatAt: run.heartbeatAt.toISOString(),
      },
    });
    log.warn(
      { runId: run.id, taskId: run.taskId, ownerId: run.ownerId },
      '[jury-run] Reclaimed a review with a dead heartbeat — lock released',
    );
  }
  return dead.length;
}

/**
 * Startup pass: no review can still be beating for a previous process.
 *
 * @param serverStartedAt - This process's start time / このプロセスの起動時刻
 * @returns Number reclaimed / 回収件数
 */
export function recoverJuryRunsAtStartup(serverStartedAt: Date): Promise<number> {
  return reclaimJuryRuns(serverStartedAt, 'process_restarted');
}

/**
 * One periodic pass (90 s stale threshold).
 *
 * @param now - Clock (tests) / 現在時刻
 * @returns Number reclaimed / 回収件数
 */
export function sweepStaleJuryRuns(now: number = Date.now()): Promise<number> {
  return reclaimJuryRuns(new Date(now - JURY_RUN_STALE_MS), 'heartbeat_stale');
}

/** Start the periodic sweep (idempotent; main process only). */
export function startJuryRunSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepStaleJuryRuns().catch((err: unknown) =>
      log.error({ err }, '[jury-run] Sweep tick failed'),
    );
  }, JURY_RUN_SWEEP_INTERVAL_MS);
  log.info('[jury-run] Stale jury-run sweep started');
}
