/**
 * Study Sessions API Routes
 *
 * CRUD for recorded study-time blocks (学習ロードマップの時間記録).
 * Streak synchronization lives in services/learning/study-time.ts — this
 * layer only validates and delegates.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { ValidationError } from '../../middleware/error-handler';
import { deleteStudySession, recordStudySession } from '../../services/learning/study-time';

export const studySessionsRoutes = new Elysia({ prefix: '/study-sessions' })
  // Recent sessions, newest first (for the roadmap's recent-log display).
  .get('/', async ({ query }) => {
    const days = parseInt((query as { days?: string }).days ?? '') || 14;
    const since = new Date(Date.now() - days * 86_400_000);
    return prisma.studySession.findMany({
      where: { studiedAt: { gte: since } },
      orderBy: { studiedAt: 'desc' },
      take: 100,
    });
  })

  .post(
    '/',
    async ({ body }) => {
      if (!Number.isFinite(body.minutes) || body.minutes <= 0) {
        throw new ValidationError('学習時間(分)は1以上で指定してください');
      }
      return recordStudySession({
        minutes: body.minutes,
        goalId: body.goalId ?? null,
        source: body.source ?? 'manual',
        note: body.note?.trim() || null,
        studiedAt: body.studiedAt ? new Date(body.studiedAt) : undefined,
      });
    },
    {
      body: t.Object({
        minutes: t.Number({ minimum: 1, maximum: 1440 }),
        goalId: t.Optional(t.Nullable(t.Number())),
        source: t.Optional(
          t.Union([t.Literal('manual'), t.Literal('pomodoro'), t.Literal('vocab')]),
        ),
        note: t.Optional(t.Nullable(t.String())),
        studiedAt: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  .delete('/:id', async ({ params }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) throw new ValidationError('無効なIDです');
    const deleted = await deleteStudySession(id);
    if (!deleted) throw new ValidationError('学習記録が見つかりません');
    return { success: true };
  });
