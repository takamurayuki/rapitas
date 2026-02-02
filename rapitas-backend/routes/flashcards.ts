/**
 * Flashcards API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";

export const flashcardsRoutes = new Elysia()
  .get("/flashcard-decks", async () => {
    return await prisma.flashcardDeck.findMany({
      include: {
        _count: { select: { cards: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  })

  .get("/flashcard-decks/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    return await prisma.flashcardDeck.findUnique({
      where: { id },
      include: {
        cards: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  })

  .post(
    "/flashcard-decks",
    async ({
      body,
    }: {
      body: {
        name: string;
        description?: string;
        color?: string;
        taskId?: number;
      };
    }) => {
      const { name, description, color, taskId } = body;
      return await prisma.flashcardDeck.create({
        data: {
          name,
          ...(description && { description }),
          ...(color && { color }),
          ...(taskId && { taskId }),
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
    }
  )

  .delete("/flashcard-decks/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    return await prisma.flashcardDeck.delete({ where: { id } });
  })

  .post(
    "/flashcard-decks/:deckId/cards",
    async ({
      params,
      body,
    }: {
      params: { deckId: string };
      body: { front: string; back: string };
    }) => {
      const deckId = parseInt(params.deckId);
      const { front, back } = body;
      return await prisma.flashcard.create({
        data: {
          deckId,
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
    }
  )

  .patch(
    "/flashcards/:id",
    async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { front?: string; back?: string };
    }) => {
      const id = parseInt(params.id);
      const { front, back } = body;
      return await prisma.flashcard.update({
        where: { id },
        data: {
          ...(front && { front }),
          ...(back && { back }),
        },
      });
    }
  )

  .delete("/flashcards/:id", async ({ params }: { params: { id: string } }) => {
    const id = parseInt(params.id);
    return await prisma.flashcard.delete({ where: { id } });
  })

  // フラッシュカード復習（SM-2アルゴリズム）
  .post(
    "/flashcards/:id/review",
    async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { quality: number };
    }) => {
      const id = parseInt(params.id);
      const { quality } = body; // 0-5 (0=完全忘れ, 5=完璧)

      const card = await prisma.flashcard.findUnique({
        where: { id },
      });
      if (!card) return { error: "Card not found" };

      let { interval, easeFactor, reviewCount } = card;

      // SM-2アルゴリズム
      if (quality >= 3) {
        if (reviewCount === 0) {
          interval = 1;
        } else if (reviewCount === 1) {
          interval = 6;
        } else {
          interval = Math.round(interval * easeFactor);
        }
        reviewCount++;
      } else {
        reviewCount = 0;
        interval = 1;
      }

      easeFactor = Math.max(
        1.3,
        easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
      );

      const nextReview = new Date();
      nextReview.setDate(nextReview.getDate() + interval);

      return await prisma.flashcard.update({
        where: { id },
        data: {
          interval,
          easeFactor,
          reviewCount,
          nextReview,
        },
      });
    }
  )

  // 今日復習すべきカード
  .get("/flashcards/due", async () => {
    const today = new Date();
    return await prisma.flashcard.findMany({
      where: {
        OR: [{ nextReview: null }, { nextReview: { lte: today } }],
      },
      include: {
        deck: true,
      },
      orderBy: { nextReview: "asc" },
    });
  });
