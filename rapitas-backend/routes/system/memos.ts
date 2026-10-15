/**
 * Memos API Routes
 *
 * CRUD for lightweight memos (quick-capture メモモード + /memos list page).
 * Reminder delivery lives in services/scheduling/memo-reminder-scheduler.ts.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { ValidationError } from '../../middleware/error-handler';
import { rearmMemoReminders } from '../../services/scheduling/memo-reminder-scheduler';

/** Parse a numeric path id or throw a 400. */
function parseId(raw: string): number {
  const id = parseInt(raw);
  if (isNaN(id)) throw new ValidationError('無効なIDです');
  return id;
}

/** Normalize an optional ISO date string field to Date|null|undefined. */
const asDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null || v === '' ? null : new Date(v);

const memoBody = t.Object({
  content: t.Optional(t.String()),
  remindAt: t.Optional(t.Nullable(t.String())),
  isDone: t.Optional(t.Boolean()),
});

export const memosRoutes = new Elysia({ prefix: '/memos' })
  // Newest first; `filter` narrows to reminder-carrying or done memos.
  .get('/', async ({ query }) => {
    const { filter } = query as { filter?: string };
    const where =
      filter === 'reminder'
        ? { remindAt: { not: null }, isDone: false }
        : filter === 'done'
          ? { isDone: true }
          : filter === 'open'
            ? { isDone: false }
            : {};
    return prisma.memo.findMany({ where, orderBy: { createdAt: 'desc' } });
  })

  .post(
    '/',
    async ({ body }) => {
      const content = body.content?.trim();
      if (!content) throw new ValidationError('メモの内容は必須です');
      const remindAt = asDate(body.remindAt) ?? null;
      if (remindAt && isNaN(remindAt.getTime())) {
        throw new ValidationError('リマインダー日時が不正です');
      }
      const memo = await prisma.memo.create({ data: { content, remindAt } });
      // Re-arm the precise timer so this reminder fires at its exact time.
      if (remindAt) void rearmMemoReminders();
      return memo;
    },
    { body: memoBody },
  )

  .patch(
    '/:id',
    async ({ params, body }) => {
      const id = parseId(params.id);
      const remindAt = asDate(body.remindAt);
      if (remindAt && isNaN(remindAt.getTime())) {
        throw new ValidationError('リマインダー日時が不正です');
      }
      const memo = await prisma.memo.update({
        where: { id },
        data: {
          ...(body.content !== undefined && { content: body.content.trim() }),
          // Changing the reminder re-arms it (clears the one-shot stamp).
          ...(remindAt !== undefined && { remindAt, remindedAt: null }),
          ...(body.isDone !== undefined && { isDone: body.isDone }),
        },
      });
      // Reminder timing may have changed — re-aim the precise timer.
      if (remindAt !== undefined || body.isDone !== undefined) void rearmMemoReminders();
      return memo;
    },
    { body: memoBody },
  )

  .delete('/:id', async ({ params }) => {
    const id = parseId(params.id);
    await prisma.memo.delete({ where: { id } });
    // The deleted memo may have been the next-armed reminder.
    void rearmMemoReminders();
    return { success: true };
  });
