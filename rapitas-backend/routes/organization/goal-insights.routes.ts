/**
 * goal-insights routes
 *
 * Read-only metrics for whether the product reaches its purpose (reach rate,
 * resume-after-stall rate, outcome quality, felt progress). Loads rows and
 * delegates every calculation to services/goals/goal-insights. Mounted under
 * /goal-insights, not /goals, so it can never be read as /goals/:id.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import {
  INSIGHT_PERIODS,
  MILESTONE_REOPENED_EVENT,
  computeInsights,
  type InsightGoal,
  type ReopenRecord,
} from '../../services/goals';

/** Read the reopen payload; unreadable rows are skipped rather than failing the page. */
function parseReopen(payload: string): ReopenRecord | null {
  try {
    const p = JSON.parse(payload) as { milestoneId?: unknown; reachedAt?: unknown };
    if (typeof p.milestoneId !== 'number') return null;
    return {
      milestoneId: p.milestoneId,
      reachedAt: typeof p.reachedAt === 'string' ? p.reachedAt : null,
    };
  } catch {
    return null;
  }
}

const goalInsightsRoutes = new Elysia({ prefix: '/goal-insights' }).get(
  '/',
  async ({ query }) => {
    const period = query.period ?? '4w';
    const [projects, events] = await Promise.all([
      prisma.project.findMany({
        select: {
          id: true,
          name: true,
          createdAt: true,
          milestones: {
            select: { id: true, status: true, dueDate: true, reachedAt: true, updatedAt: true },
          },
          tasks: {
            select: { status: true, updatedAt: true, completedAt: true },
          },
        },
      }),
      prisma.timelineEvent.findMany({
        where: { eventType: MILESTONE_REOPENED_EVENT },
        select: { payload: true },
      }),
    ]);

    const goals: InsightGoal[] = projects;
    const reopenEvents = events.flatMap((e) => parseReopen(e.payload) ?? []);
    return computeInsights({ goals, reopenEvents, now: new Date(), period });
  },
  {
    query: t.Object({
      period: t.Optional(t.Union(INSIGHT_PERIODS.map((p) => t.Literal(p)))),
    }),
  },
);

export default goalInsightsRoutes;
