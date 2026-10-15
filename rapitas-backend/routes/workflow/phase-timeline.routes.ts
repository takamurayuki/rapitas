/**
 * phase-timeline routes
 *
 * GET /workflow/tasks/:taskId/phase-timeline — task #785. Aggregates a
 * task's AgentExecution rows across ALL its AgentSessions (unlike
 * /tasks/:id/execution-logs, which only looks at the latest session) into
 * research/plan/implement/verify phase segments for the task-detail
 * execution log timeline. Thin layer — segmentation/summary logic lives in
 * services/workflow/phase-segmentation.ts and phase-summary-metrics.ts.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import {
  segmentPhases,
  selectPhaseType,
  type RawPhaseExecution,
  type RawPhaseTransition,
} from '../../services/workflow/phase-segmentation';
import { generateSummary } from '../../services/workflow/phase-summary-metrics';

const log = createLogger('routes:phase-timeline');

const phaseTimelineRoutes = new Elysia({ prefix: '/workflow' }).get(
  '/tasks/:taskId/phase-timeline',
  async (ctx) => {
    const params = ctx.params as { taskId: string };
    const taskId = parseInt(params.taskId, 10);
    if (!Number.isFinite(taskId)) {
      ctx.set.status = 400;
      return { success: false, error: 'invalid taskId' };
    }

    try {
      const [config, transitions, planFile, task] = await Promise.all([
        prisma.developerModeConfig.findUnique({
          where: { taskId },
          include: {
            agentSessions: {
              orderBy: { createdAt: 'asc' },
              include: {
                agentExecutions: {
                  orderBy: { createdAt: 'asc' },
                  include: { _count: { select: { executionLogs: true } } },
                },
              },
            },
          },
        }),
        prisma.workflowTransition.findMany({
          where: { taskId },
          select: { cause: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.workflowFile.findFirst({
          where: { taskId, fileType: 'plan' },
          select: { id: true },
        }),
        // Task status drives the header badge (進行中/ブロック中/完了) — phase
        // data alone can't distinguish "between phases" from "all done".
        prisma.task.findUnique({
          where: { id: taskId },
          select: { status: true, workflowMode: true, complexityScore: true },
        }),
      ]);

      const modelByExecutionId = new Map<number, string | null>();
      for (const session of config?.agentSessions ?? []) {
        for (const e of session.agentExecutions) modelByExecutionId.set(e.id, e.modelName);
      }

      const rawExecutions: RawPhaseExecution[] = (config?.agentSessions ?? []).flatMap((session) =>
        session.agentExecutions.map((e) => ({
          id: e.id,
          phaseType: selectPhaseType(session.mode),
          status: e.status,
          startedAt: e.startedAt,
          completedAt: e.completedAt,
          createdAt: e.createdAt,
          logLineCount: e._count.executionLogs,
        })),
      );

      const rawTransitions: RawPhaseTransition[] = transitions.map((t) => ({
        cause: t.cause,
        createdAt: t.createdAt,
      }));

      const { phases, workflowMode } = segmentPhases(rawExecutions, rawTransitions, !!planFile);

      // Only the verify phase's summary needs log text (pass/fail extraction) —
      // fetch it per-iteration rather than for every phase to keep this cheap.
      const verifyExecutionIds =
        phases.find((p) => p.phaseType === 'verify')?.iterations.flatMap((it) => it.executionIds) ??
        [];
      const verifyLogChunks = verifyExecutionIds.length
        ? await prisma.agentExecutionLog.findMany({
            where: { executionId: { in: verifyExecutionIds } },
            select: { executionId: true, logChunk: true },
          })
        : [];
      const logTextByExecutionId = new Map<number, string>();
      for (const row of verifyLogChunks) {
        logTextByExecutionId.set(
          row.executionId,
          (logTextByExecutionId.get(row.executionId) ?? '') + row.logChunk,
        );
      }

      const phasesWithSummary = phases.map((phase) => ({
        phaseType: phase.phaseType,
        iterations: phase.iterations.map((iteration) => {
          const logText = iteration.executionIds
            .map((id) => logTextByExecutionId.get(id) ?? '')
            .join('\n');
          // Last non-null model wins — a repair retry within the iteration may
          // have escalated to a different model than the first attempt.
          const modelName =
            [...iteration.executionIds]
              .reverse()
              .map((id) => modelByExecutionId.get(id))
              .find((m) => m != null) ?? null;
          return {
            ...iteration,
            modelName,
            summary: generateSummary(iteration, phase.phaseType, logText),
          };
        }),
      }));

      return {
        success: true,
        taskId,
        phases: phasesWithSummary,
        workflowMode,
        taskStatus: task?.status ?? null,
        // Planned mode (complexity staging) — lets the UI render the full
        // expected tab strip before the first execution even starts.
        plannedMode: task?.workflowMode ?? null,
        complexityScore: task?.complexityScore ?? null,
      };
    } catch (err) {
      log.error({ err, taskId }, '[phase-timeline] failed to build phase timeline');
      ctx.set.status = 500;
      return { success: false, error: 'failed to build phase timeline' };
    }
  },
);

export default phaseTimelineRoutes;
