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
import {
  getHostCpuBusyPercent,
  getRapitasCpuBusyPercent,
  getRapitasCpuWindowMs,
} from '../../../services/system/resource-telemetry';
import {
  isResourceGateEnabled,
  requestResourceGateOverride,
  resolveResourceGateThreshold,
} from '../../../services/workflow/auto-run/resource-contention-gate';
import { parseId } from '../../../middleware/error-handler';

export const resourceGateRouter = new Elysia({ prefix: '/agents/resource-gate' })
  /**
   * Current gate configuration and CPU usage. The gate decides on
   * rapitasCpuBusyPercent (rapitas's process tree, windowMs average, task
   * 1553); hostCpuBusyPercent is kept for reference.
   */
  .get('/status', () => {
    return {
      enabled: isResourceGateEnabled(),
      thresholdPercent: resolveResourceGateThreshold(),
      hostCpuBusyPercent: getHostCpuBusyPercent(),
      rapitasCpuBusyPercent: getRapitasCpuBusyPercent(),
      windowMs: getRapitasCpuWindowMs(),
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
      requestResourceGateOverride(parseId(params.themeId, 'theme ID'));
      set.status = 204;
    },
    { params: t.Object({ themeId: t.String() }) },
  );
