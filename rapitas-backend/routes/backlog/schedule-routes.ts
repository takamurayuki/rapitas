/**
 * backlog schedule routes
 *
 * HTTP API for configuring the backlog's periodic AI jobs (innovation session,
 * vulnerability/bug scan): read/update their timing, and trigger an immediate
 * run. Thin layer — delegates to backlog-schedule-service and the scheduler.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import {
  listSchedules,
  updateSchedule,
  normalizeJobKind,
} from '../../services/scheduling/backlog-schedule-service';
import { runBacklogJobNow } from '../../services/scheduling/backlog-scheduler';
import { computeLoopMetrics } from '../../services/self-improvement/loop-metrics';

const log = createLogger('routes:backlog-schedule');

export const backlogScheduleRoutes = new Elysia({ prefix: '/backlog' })
  /** List both job schedules (seeds defaults on first read). */
  .get('/schedules', async () => {
    return { schedules: await listSchedules() };
  })

  /**
   * Quality-improvement-loop metrics: weekly bounce/repair counts from the
   * WorkflowTransition log. The measured basis for the loop_review job and
   * for judging whether a loop intervention actually moved the numbers.
   */
  .get(
    '/loop-metrics',
    async ({ query }) => {
      const weeks = Math.min(12, Math.max(2, Number(query.weeks) || 5));
      return await computeLoopMetrics({ windowCount: weeks });
    },
    { query: t.Object({ weeks: t.Optional(t.String()) }) },
  )

  /** Update one job's timing/enabled state. */
  .patch(
    '/schedules/:kind',
    async ({ params, body, set }) => {
      const kind = normalizeJobKind(params.kind);
      if (!kind) {
        set.status = 400;
        return { error: `不明なジョブ種別です: ${params.kind}` };
      }
      try {
        const schedule = await updateSchedule(kind, body);
        return { success: true, schedule };
      } catch (err) {
        log.error({ err, kind }, 'Failed to update backlog schedule');
        set.status = 500;
        return { error: 'スケジュールの保存に失敗しました' };
      }
    },
    {
      params: t.Object({ kind: t.String() }),
      body: t.Object({
        enabled: t.Optional(t.Boolean()),
        frequency: t.Optional(t.String()),
        hour: t.Optional(t.Number()),
        weekday: t.Optional(t.Number()),
      }),
    },
  )

  /** Trigger a job immediately (fire-and-forget — results land in the backlog). */
  .post(
    '/schedules/:kind/run-now',
    async ({ params, set }) => {
      const kind = normalizeJobKind(params.kind);
      if (!kind) {
        set.status = 400;
        return { error: `不明なジョブ種別です: ${params.kind}` };
      }
      // Don't await — LLM jobs take tens of seconds; the UI polls the backlog.
      void runBacklogJobNow(kind).catch((err) => {
        log.warn({ err, kind }, 'Manual backlog job run failed');
      });
      return { success: true, started: true };
    },
    { params: t.Object({ kind: t.String() }) },
  );
