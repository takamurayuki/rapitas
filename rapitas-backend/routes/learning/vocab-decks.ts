/**
 * Vocabulary Book (単語帳) API Routes
 *
 * Deck/card CRUD plus the spaced-repetition review flow (due queue + grading).
 * Schedule math lives in services/learning/vocab-srs.ts.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { ValidationError } from '../../middleware/error-handler';
import { computeNextReview, type VocabGrade } from '../../services/learning/vocab-srs';
import {
  buildRecommendations,
  computeHourBuckets,
  computeRetentionCurve,
  estimateStability,
} from '../../services/learning/vocab-analytics';

/** Parse a numeric path id or throw a 400. */
function parseId(raw: string): number {
  const id = parseInt(raw);
  if (isNaN(id)) throw new ValidationError('無効なIDです');
  return id;
}

export const vocabDecksRoutes = new Elysia({ prefix: '/vocab' })
  // Learning analytics: personal forgetting curve vs the Ebbinghaus reference,
  // time-of-day performance, hardest cards, and rule-based study advice.
  .get(
    '/analytics',
    async ({ query }) => {
      const deckId = query.deckId ? parseInt(query.deckId) : undefined;
      const logs = await prisma.vocabReviewLog.findMany({
        where: deckId ? { deckId } : {},
        orderBy: { reviewedAt: 'asc' },
        select: {
          cardId: true,
          grade: true,
          elapsedDays: true,
          repetitions: true,
          reviewedAt: true,
        },
      });
      const curve = computeRetentionCurve(logs);
      const hours = computeHourBuckets(logs);
      const eligible = logs.filter((l) => l.repetitions > 0);
      const overallRetention =
        eligible.length > 0
          ? Math.round((eligible.filter((l) => l.grade !== 'again').length / eligible.length) * 100)
          : null;

      // Hardest cards = most 'again' grades; join fronts for display (cards
      // deleted since keep their logs but drop off this list).
      const againCounts = new Map<number, number>();
      for (const l of logs) {
        if (l.grade === 'again') againCounts.set(l.cardId, (againCounts.get(l.cardId) ?? 0) + 1);
      }
      const hardestIds = [...againCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      const hardCards =
        hardestIds.length > 0
          ? await prisma.vocabCard.findMany({
              where: { id: { in: hardestIds.map(([id]) => id) } },
              select: { id: true, front: true, back: true },
            })
          : [];
      const hardest = hardestIds.flatMap(([id, count]) => {
        const c = hardCards.find((x) => x.id === id);
        return c ? [{ id, front: c.front, back: c.back, lapses: count }] : [];
      });

      return {
        totalReviews: logs.length,
        retentionReviews: eligible.length,
        overallRetention,
        stability: estimateStability(curve),
        curve,
        hours,
        hardest,
        recommendations: buildRecommendations(logs, curve, hours),
      };
    },
    { query: t.Object({ deckId: t.Optional(t.String()) }) },
  )

  // Deck list with card counts and how many are due for review now.
  .get('/decks', async () => {
    const [decks, dueCounts] = await Promise.all([
      prisma.vocabDeck.findMany({
        include: { _count: { select: { cards: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.vocabCard.groupBy({
        by: ['deckId'],
        where: { dueAt: { lte: new Date() } },
        _count: { id: true },
      }),
    ]);
    const dueByDeck = new Map(dueCounts.map((d) => [d.deckId, d._count.id]));
    return decks.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      cardCount: d._count.cards,
      dueCount: dueByDeck.get(d.id) ?? 0,
      updatedAt: d.updatedAt,
    }));
  })

  .post(
    '/decks',
    async ({ body }) => {
      return prisma.vocabDeck.create({
        data: { name: body.name.trim(), description: body.description?.trim() || null },
      });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  .patch(
    '/decks/:id',
    async ({ params, body }) => {
      const id = parseId(params.id);
      return prisma.vocabDeck.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(body.description !== undefined && { description: body.description?.trim() || null }),
        },
      });
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        description: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  .delete('/decks/:id', async ({ params }) => {
    const id = parseId(params.id);
    await prisma.vocabDeck.delete({ where: { id } });
    return { success: true };
  })

  // Deck detail: cards ordered newest-first, plus due count for the review CTA.
  .get('/decks/:id', async ({ params }) => {
    const id = parseId(params.id);
    const deck = await prisma.vocabDeck.findUnique({
      where: { id },
      include: { cards: { orderBy: { createdAt: 'desc' } } },
    });
    if (!deck) throw new ValidationError('単語帳が見つかりません');
    const now = Date.now();
    return {
      ...deck,
      dueCount: deck.cards.filter((c) => c.dueAt.getTime() <= now).length,
    };
  })

  .post(
    '/decks/:id/cards',
    async ({ params, body }) => {
      const deckId = parseId(params.id);
      return prisma.vocabCard.create({
        data: {
          deckId,
          front: body.front.trim(),
          back: body.back.trim(),
          note: body.note?.trim() || null,
        },
      });
    },
    {
      body: t.Object({
        front: t.String({ minLength: 1 }),
        back: t.String({ minLength: 1 }),
        note: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  .patch(
    '/cards/:id',
    async ({ params, body }) => {
      const id = parseId(params.id);
      return prisma.vocabCard.update({
        where: { id },
        data: {
          ...(body.front !== undefined && { front: body.front.trim() }),
          ...(body.back !== undefined && { back: body.back.trim() }),
          ...(body.note !== undefined && { note: body.note?.trim() || null }),
        },
      });
    },
    {
      body: t.Object({
        front: t.Optional(t.String({ minLength: 1 })),
        back: t.Optional(t.String({ minLength: 1 })),
        note: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  .delete('/cards/:id', async ({ params }) => {
    const id = parseId(params.id);
    await prisma.vocabCard.delete({ where: { id } });
    return { success: true };
  })

  // Review queue: cards due now, oldest-due first so overdue cards surface.
  .get(
    '/decks/:id/review',
    async ({ params, query }) => {
      const deckId = parseId(params.id);
      const limit = Math.min(50, Math.max(1, query.limit ? parseInt(query.limit) : 20));
      const cards = await prisma.vocabCard.findMany({
        where: { deckId, dueAt: { lte: new Date() } },
        orderBy: { dueAt: 'asc' },
        take: limit,
      });
      return { cards, total: cards.length };
    },
    { query: t.Object({ limit: t.Optional(t.String()) }) },
  )

  // Grade a card: apply SM-2-lite and persist the next schedule.
  .post(
    '/cards/:id/review',
    async ({ params, body }) => {
      const id = parseId(params.id);
      const card = await prisma.vocabCard.findUnique({ where: { id } });
      if (!card) throw new ValidationError('カードが見つかりません');

      const now = new Date();
      const next = computeNextReview(card, body.grade as VocabGrade, now);
      const updated = await prisma.vocabCard.update({
        where: { id },
        data: {
          intervalDays: next.intervalDays,
          easeFactor: next.easeFactor,
          repetitions: next.repetitions,
          lapses: next.lapses,
          dueAt: next.dueAt,
          reviewedAt: now,
        },
      });
      // Log the review for the forgetting-curve analytics (best-effort — a
      // failed log must never fail the review itself).
      const since = card.reviewedAt ?? card.createdAt;
      await prisma.vocabReviewLog
        .create({
          data: {
            cardId: card.id,
            deckId: card.deckId,
            grade: body.grade,
            elapsedDays: Math.max(0, (now.getTime() - since.getTime()) / 86_400_000),
            intervalDays: card.intervalDays,
            repetitions: card.repetitions,
            reviewedAt: now,
          },
        })
        .catch(() => {});
      return updated;
    },
    {
      body: t.Object({
        grade: t.Union([t.Literal('again'), t.Literal('good'), t.Literal('easy')]),
      }),
    },
  );
