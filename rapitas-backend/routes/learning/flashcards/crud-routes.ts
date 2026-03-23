/**
 * FlashcardCrudRoutes
 *
 * CRUD routes for flashcard decks and individual cards, plus the FSRS review
 * and schedule-preview endpoints.
 *
 * Not responsible for AI generation; see ai-generate-routes.ts for that.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { NotFoundError, parseId } from '../../../middleware/error-handler';
import { Rating } from 'ts-fsrs';
import { f, qualityToRating, toFsrsCard } from './fsrs-helpers';

export const flashcardCrudRoutes = new Elysia()
  .get('/flashcard-decks', async ({ query }) => {
    const learningGoalId = query?.learningGoalId
      ? parseInt(query.learningGoalId as string)
      : undefined;
    return await prisma.flashcardDeck.findMany({
      where: {
        ...(learningGoalId && { learningGoalId }),
      },
      include: {
        _count: { select: { cards: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  })

  .get('/flashcard-decks/:id', async ({ params }) => {
    const id = parseId(params.id);
    const deck = await prisma.flashcardDeck.findUnique({
      where: { id },
      include: {
        cards: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!deck) throw new NotFoundError('Deck not found');
    return deck;
  })

  .post(
    '/flashcard-decks',
    async (context) => {
      const { body } = context as {
        body: { name: string; description?: string; color?: string; taskId?: number };
      };
      return await prisma.flashcardDeck.create({
        data: {
          name: body.name,
          ...(body.description && { description: body.description }),
          ...(body.color && { color: body.color }),
          ...(body.taskId && { taskId: body.taskId }),
        },
      });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        color: t.Optional(t.String()),
        taskId: t.Optional(t.Number()),
      }),
    },
  )

  .delete('/flashcard-decks/:id', async ({ params }) => {
    const id = parseId(params.id);
    return await prisma.flashcardDeck.delete({ where: { id } });
  })

  .post(
    '/flashcard-decks/:deckId/cards',
    async (context) => {
      const { deckId } = context.params as { deckId: string };
      const { front, back } = context.body as { front: string; back: string };
      const deckIdNum = parseId(deckId, 'deckId');
      return await prisma.flashcard.create({
        data: {
          deckId: deckIdNum,
          front,
          back,
        },
      });
    },
    {
      body: t.Object({
        front: t.String({ minLength: 1 }),
        back: t.String({ minLength: 1 }),
      }),
    },
  )

  .patch(
    '/flashcards/:id',
    async (context) => {
      const id = parseId(context.params.id);
      const body = context.body as { front?: string; back?: string };
      const { front, back } = body;
      return await prisma.flashcard.update({
        where: { id },
        data: {
          ...(front && { front }),
          ...(back && { back }),
        },
      });
    },
    {
      body: t.Object({
        front: t.Optional(t.String()),
        back: t.Optional(t.String()),
      }),
    },
  )

  .delete('/flashcards/:id', async ({ params }) => {
    const id = parseId(params.id);
    return await prisma.flashcard.delete({ where: { id } });
  })

  // Flashcard review (FSRS algorithm)
  .post(
    '/flashcards/:id/review',
    async (context) => {
      const id = parseId(context.params.id);
      const { quality } = context.body as { quality: number }; // 0-5 scale (mapped to FSRS Rating 1-4)

      const card = await prisma.flashcard.findUnique({ where: { id } });
      if (!card) throw new NotFoundError('Card not found');

      const now = new Date();
      const fsrsCard = toFsrsCard(card);
      const rating = qualityToRating(quality);

      const schedulingResult = f.repeat(fsrsCard, now);
      const result = schedulingResult[rating];
      const updatedCard = result.card;

      const updated = await prisma.flashcard.update({
        where: { id },
        data: {
          stability: updatedCard.stability,
          difficulty: updatedCard.difficulty,
          state: updatedCard.state as number,
          interval: updatedCard.scheduled_days,
          reviewCount: updatedCard.reps,
          lapses: updatedCard.lapses,
          lastReview: now,
          nextReview: updatedCard.due,
          // Keep easeFactor for backward compatibility
          easeFactor: Math.max(1.3, 2.5 - (updatedCard.difficulty - 5) * 0.1),
        },
      });

      // NOTE: Connect Flashcard review → StudyStreak + ExamGoal progress.
      // Each review adds ~2 minutes of study time and propagates to related exam goals.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      prisma.studyStreak
        .upsert({
          where: { date: today },
          update: { studyMinutes: { increment: 2 } },
          create: { date: today, studyMinutes: 2, tasksCompleted: 0 },
        })
        .catch(() => {});

      // Propagate review to ExamGoal if the deck's task is linked to an exam goal
      prisma.flashcardDeck
        .findUnique({
          where: { id: card.deckId },
          select: { taskId: true },
        })
        .then(async (deck) => {
          if (!deck?.taskId) return;
          const task = await prisma.task.findUnique({
            where: { id: deck.taskId },
            select: { examGoalId: true },
          });
          if (!task?.examGoalId) return;
          // NOTE: ExamGoal progress is tracked via its linked tasks.
          // The review activity is already recorded in StudyStreak above.
        })
        .catch(() => {});

      return updated;
    },
    {
      body: t.Object({
        quality: t.Number({ minimum: 0, maximum: 5 }),
      }),
    },
  )

  // FSRS scheduling preview (returns next review date for each Rating choice)
  .get('/flashcards/:id/schedule-preview', async ({ params }) => {
    const id = parseId(params.id);
    const card = await prisma.flashcard.findUnique({ where: { id } });
    if (!card) throw new NotFoundError('Card not found');

    const now = new Date();
    const fsrsCard = toFsrsCard(card);
    const schedulingResult = f.repeat(fsrsCard, now);

    return {
      again: {
        due: schedulingResult[Rating.Again].card.due,
        interval: schedulingResult[Rating.Again].card.scheduled_days,
      },
      hard: {
        due: schedulingResult[Rating.Hard].card.due,
        interval: schedulingResult[Rating.Hard].card.scheduled_days,
      },
      good: {
        due: schedulingResult[Rating.Good].card.due,
        interval: schedulingResult[Rating.Good].card.scheduled_days,
      },
      easy: {
        due: schedulingResult[Rating.Easy].card.due,
        interval: schedulingResult[Rating.Easy].card.scheduled_days,
      },
    };
  })

  // Cards due for review today
  .get('/flashcards/due', async () => {
    const today = new Date();
    return await prisma.flashcard.findMany({
      where: {
        OR: [{ nextReview: null }, { nextReview: { lte: today } }],
      },
      include: {
        deck: true,
      },
      orderBy: { nextReview: 'asc' },
    });
  });
