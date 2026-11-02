/**
 * Top-level health route
 *
 * Extracted from index.ts's inline `/health` handler so the composition
 * root stays under the file-size ratchet gate (.baselines/file-size.json).
 * Logic is an unmodified copy — do not add new fields here without also
 * updating the ratchet baseline discussion in plan.md.
 */
import { prisma } from '../../config';
import { getAgentSystemSnapshot } from '../agents/system/agent-system-router';
import { getReadinessSnapshot } from '../../services/system/startup-readiness';

/**
 * Handle the top-level `/health` liveness check aggregating DB connectivity
 * and the shared agent system snapshot.
 *
 * @returns Health payload on success, or a 503 `Response` on DB failure
 */
export async function handleTopLevelHealthCheck(): Promise<Record<string, unknown> | Response> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const snapshot = await getAgentSystemSnapshot();
    const readiness = getReadinessSnapshot();
    return {
      // NOTE: `status` keeps its old values on purpose (#1323). Warm-up runs
      // after the listener opens and can outlast the 30s health timeouts in
      // dev.js / restart-loop-smoke / CI, all of which gate on
      // `status === 'healthy'` — reporting 'warming' there would turn a
      // readiness signal into a startup failure. The new truth rides on
      // `ready` instead, which a caller that needs to WRITE should wait for:
      // `database: 'connected'` means the connection works, not that a write
      // will land (measured: SQLITE_IOERR_SHORT_READ inside this window).
      status:
        snapshot.status === 'healthy' || snapshot.status === 'busy' ? 'healthy' : snapshot.status,
      database: 'connected',
      ready: readiness.ready,
      warmupStage: readiness.warmupStage,
      readyAfterMs: readiness.readyAfterMs,
      uptimeSeconds: Math.round(process.uptime()),
      activeExecutions: snapshot.activeExecutions,
      runningExecutions: snapshot.runningExecutions,
      interruptedExecutions: snapshot.interruptedExecutions,
      interruptedExecutionsHistoryCount: snapshot.interruptedExecutionsHistoryCount,
      interruptedExecutionsDegraded: snapshot.interruptedExecutionsDegraded,
      queueDepth: snapshot.queueDepth,
      activePreviewCount: snapshot.activePreviewCount,
      checkMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return Response.json(
      {
        status: 'unhealthy',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}

/**
 * Handle the `/health` liveness check while API Recovery mode is active.
 *
 * Unlike {@link handleTopLevelHealthCheck}, this skips the agent-system
 * snapshot (unavailable/unreliable during recovery) and only confirms DB
 * connectivity, mirroring the same fail-closed shape on query failure.
 *
 * @returns Recovery-mode health payload on success, or a 503 `Response` on DB failure
 */
export async function handleApiRecoveryHealthCheck(): Promise<Record<string, unknown> | Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: 'healthy',
      mode: 'api-recovery',
      backgroundInitialization: false,
      uptimeSeconds: process.uptime(),
    };
  } catch (error) {
    return Response.json(
      {
        status: 'unhealthy',
        reason: 'database',
        mode: 'api-recovery',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
