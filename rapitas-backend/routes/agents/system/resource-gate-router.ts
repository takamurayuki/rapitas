/**
 * Resource Gate Router
 *
 * Read-only status/history plus a one-shot manual override for the
 * resource-contention gate (task 725). Not responsible for the gate decision
 * itself (see services/workflow/auto-run/resource-contention-gate.ts) or for
 * inserting it into auto-run selection (see auto-run-advance-select.ts).
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { WorkflowQueueService } from '../../../services/workflow/workflow-queue';
import { getHostCpuBusyPercent } from '../../../services/system/resource-telemetry';
import { requestResourceGateOverride } from '../../../services/workflow/auto-run/resource-contention-gate';

const DEFAULT_THRESHOLD_PERCENT = 85;

export const resourceGateRouter = new Elysia({ prefix: '/agents/resource-gate' })
  /**
   * Current gate configuration and the latest sampled host CPU usage.
   */
  .get('/status', () => {
    return {
      enabled: process.env.RAPITAS_RESOURCE_GATE_ENABLED === 'true',
      thresholdPercent: Number(
        process.env.RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT || DEFAULT_THRESHOLD_PERCENT,
      ),
      hostCpuBusyPercent: getHostCpuBusyPercent(),
      effectiveMaxConcurrency: WorkflowQueueService.getInstance().getMaxConcurrency(),
    };
  })

  /**
   * Recent resource-deferral events, most recent first.
   */
  .get(
    '/deferrals',
    async ({ query }) => {
      const limit = query.limit ? Math.min(100, Math.max(1, parseInt(query.limit, 10))) : 20;
      const rows = await prisma.activityLog.findMany({
        where: { action: 'auto_run.resource_deferred' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { metadata: true, createdAt: true },
      });
      return rows.map((row) => {
        const meta = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {};
        return {
          themeId: meta.themeId ?? null,
          cpuBusyPercent: meta.cpuBusyPercent ?? null,
          thresholdPercent: meta.thresholdPercent ?? null,
          createdAt: row.createdAt,
        };
      });
    },
    { query: t.Object({ limit: t.Optional(t.String()) }) },
  )

  /**
   * Consumes exactly one held cycle for the given theme ("今すぐ実行").
   */
  .post(
    '/override/:themeId',
    ({ params, set }) => {
      requestResourceGateOverride(parseInt(params.themeId, 10));
      set.status = 204;
    },
    { params: t.Object({ themeId: t.String() }) },
  );
