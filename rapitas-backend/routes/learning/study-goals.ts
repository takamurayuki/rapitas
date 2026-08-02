/**
 * Study Goals (学習ロードマップ) API Routes
 *
 * CRUD for the unified StudyGoal model (skill + exam goals) and the
 * science-based pacing analytics (services/learning/study-plan-analytics.ts).
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { ValidationError } from '../../middleware/error-handler';
import {
  buildStudyRecommendations,
  computeStudyPace,
} from '../../services/learning/study-plan-analytics';

/** Parse a numeric path id or throw a 400. */
function parseId(raw: string): number {
  const id = parseInt(raw);
  if (isNaN(id)) throw new ValidationError('無効なIDです');
  return id;
}

const goalBody = t.Object({
  type: t.Optional(t.Union([t.Literal('skill'), t.Literal('exam')])),
  title: t.Optional(t.String({ minLength: 1 })),
  description: t.Optional(t.Nullable(t.String())),
  deadline: t.Optional(t.Nullable(t.String())),
  status: t.Optional(t.Union([t.Literal('active'), t.Literal('completed'), t.Literal('archived')])),
  color: t.Optional(t.String()),
  icon: t.Optional(t.Nullable(t.String())),
  dailyMinutes: t.Optional(t.Number({ minimum: 5, maximum: 1440 })),
  categoryId: t.Optional(t.Nullable(t.Number())),
  themeId: t.Optional(t.Nullable(t.Number())),
  currentLevel: t.Optional(t.Nullable(t.String())),
  targetLevel: t.Optional(t.Nullable(t.String())),
  targetScore: t.Optional(t.Nullable(t.String())),
  actualScore: t.Optional(t.Nullable(t.String())),
});

/** Normalize an optional ISO date string field to Date|null|undefined. */
const asDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null || v === '' ? null : new Date(v);

export const studyGoalsRoutes = new Elysia({ prefix: '/study-goals' })
  // Roadmap list: goals with linked-task progress, active first, nearest deadline first.
  .get('/', async () => {
    const goals = await prisma.studyGoal.findMany({
      orderBy: [{ status: 'asc' }, { deadline: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { tasks: true } } },
    });
    const done = await prisma.task.groupBy({
      by: ['studyGoalId'],
      where: { studyGoalId: { not: null }, status: 'done' },
      _count: { id: true },
    });
    const doneByGoal = new Map(done.map((d) => [d.studyGoalId, d._count.id]));
    return goals.map((g) => ({
      ...g,
      taskCount: g._count.tasks,
      doneTaskCount: doneByGoal.get(g.id) ?? 0,
    }));
  })

  .post(
    '/',
    async ({ body }) => {
      if (!body.title?.trim()) throw new ValidationError('タイトルは必須です');
      return prisma.studyGoal.create({
        data: {
          type: body.type ?? 'skill',
          title: body.title.trim(),
          description: body.description ?? null,
          deadline: asDate(body.deadline) ?? null,
          color: body.color ?? '#10B981',
          icon: body.icon ?? null,
          dailyMinutes: body.dailyMinutes ?? 60,
          categoryId: body.categoryId ?? null,
          themeId: body.themeId ?? null,
          currentLevel: body.currentLevel ?? null,
          targetLevel: body.targetLevel ?? null,
          targetScore: body.targetScore ?? null,
        },
      });
    },
    { body: goalBody },
  )

  .patch(
    '/:id',
    async ({ params, body }) => {
      const id = parseId(params.id);
      return prisma.studyGoal.update({
        where: { id },
        data: {
          ...(body.type !== undefined && { type: body.type }),
          ...(body.title !== undefined && { title: body.title.trim() }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.deadline !== undefined && { deadline: asDate(body.deadline) }),
          ...(body.status !== undefined && { status: body.status }),
          ...(body.color !== undefined && { color: body.color }),
          ...(body.icon !== undefined && { icon: body.icon }),
          ...(body.dailyMinutes !== undefined && { dailyMinutes: body.dailyMinutes }),
          ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
          ...(body.themeId !== undefined && { themeId: body.themeId }),
          ...(body.currentLevel !== undefined && { currentLevel: body.currentLevel }),
          ...(body.targetLevel !== undefined && { targetLevel: body.targetLevel }),
          ...(body.targetScore !== undefined && { targetScore: body.targetScore }),
          ...(body.actualScore !== undefined && { actualScore: body.actualScore }),
        },
      });
    },
    { body: goalBody },
  )

  .delete('/:id', async ({ params }) => {
    const id = parseId(params.id);
    await prisma.studyGoal.delete({ where: { id } });
    return { success: true };
  })

  // Science-based pacing analytics: distributed-practice pace, streak,
  // cramming index, daily study series, and technique-tagged recommendations.
  .get('/analytics', async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 60 * 86_400_000);
    const [goals, streaks, vocabDueCount] = await Promise.all([
      prisma.studyGoal.findMany({
        select: {
          id: true,
          type: true,
          title: true,
          deadline: true,
          dailyMinutes: true,
          status: true,
        },
      }),
      prisma.studyStreak.findMany({
        where: { date: { gte: since } },
        select: { date: true, studyMinutes: true },
        orderBy: { date: 'asc' },
      }),
      prisma.vocabCard.count({ where: { dueAt: { lte: now } } }),
    ]);
    const days = streaks.map((s) => ({ date: s.date.toISOString(), minutes: s.studyMinutes }));
    const pace = computeStudyPace(goals, days, now);
    const recommendations = buildStudyRecommendations(goals, pace, vocabDueCount, now);
    // Last 30 days as a chartable series (oldest first, gaps filled with 0).
    const byDay = new Map(days.map((d) => [d.date.slice(0, 10), d.minutes]));
    const series = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now.getTime() - (29 - i) * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      return { date: key, minutes: byDay.get(key) ?? 0 };
    });
    return { pace, recommendations, series, vocabDueCount };
  });
