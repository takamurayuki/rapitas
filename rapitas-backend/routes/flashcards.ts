/**
 * Flashcards API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { decrypt } from "../utils/encryption";

// Claude API Response Types
interface ClaudeAPIResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export const flashcardsRoutes = new Elysia()
  .get("/flashcard-decks", async () => {
    return await prisma.flashcardDeck.findMany({
      include: {
        _count: { select: { cards: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  })

  .get("/flashcard-decks/:id", async ({ 
 params }: { params: { id: string } }) => {
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

  .delete("/flashcard-decks/:id", async ({ 
 params }: { params: { id: string } }) => {
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

  .delete("/flashcards/:id", async ({ 
 params }: { params: { id: string } }) => {
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
  })

  // AIでフラッシュカードを自動生成
  .post(
    "/flashcard-decks/:deckId/generate",
    async ({ 

      params,
      body,
    }: {
      params: { deckId: string };
      body: {
        topic: string;
        count?: number;
        difficulty?: "beginner" | "intermediate" | "advanced";
        language?: "ja" | "en";
      };
    }) => {
      const deckId = parseInt(params.deckId);
      const { topic, count = 10, difficulty = "intermediate", language = "ja" } = body;

      // デッキの存在確認
      const deck = await prisma.flashcardDeck.findUnique({
        where: { id: deckId },
      });
      if (!deck) {
        return { error: "Deck not found" };
      }

      // APIキーの取得
      const settings = await prisma.userSettings.findFirst();
      let apiKey: string | undefined;

      if (settings?.claudeApiKeyEncrypted) {
        try {
          apiKey = decrypt(settings.claudeApiKeyEncrypted);
        } catch (error) {
          console.error("Failed to decrypt API key:", error);
          return { error: "Failed to decrypt API key" };
        }
      } else {
        apiKey = process.env.CLAUDE_API_KEY;
      }

      if (!apiKey) {
        return { error: "API key not configured" };
      }

      try {
        // Claude APIを使用してフラッシュカードを生成
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 4096,
            messages: [
              {
                role: "user",
                content: `
${language === "ja" ?
`「${topic}」に関するフラッシュカードを${count}枚作成してください。

条件：
- 難易度: ${difficulty === "beginner" ? "初級" : difficulty === "intermediate" ? "中級" : "上級"}
- 各カードは「質問」と「回答」のペアで構成
- 学習効果を高めるため、段階的に難しくなるように配置
- 回答は簡潔で覚えやすく、必要に応じて例や説明を含める

以下のJSON形式で出力してください：
{
  "cards": [
    {
      "front": "質問内容",
      "back": "回答内容"
    }
  ]
}` :
`Create ${count} flashcards about "${topic}".

Requirements:
- Difficulty level: ${difficulty}
- Each card consists of a "question" and "answer" pair
- Arrange cards progressively from easier to harder concepts
- Answers should be concise, memorable, and include examples when helpful

Output in the following JSON format:
{
  "cards": [
    {
      "front": "Question text",
      "back": "Answer text"
    }
  ]
}`}`,
              },
            ],
          }),
        });

        if (!response.ok) {
          throw new Error(`API request failed: ${response.statusText}`);
        }

        const data = await response.json() as ClaudeAPIResponse;
        const content = data.content[0].text;

        // JSON部分を抽出
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error("Failed to parse AI response");
        }

        const generatedData = JSON.parse(jsonMatch[0]);
        const cards = generatedData.cards;

        // フラッシュカードをDBに保存
        const createdCards = await Promise.all(
          cards.map((card: { front: string; back: string }) =>
            prisma.flashcard.create({
              data: {
                deckId,
                front: card.front,
                back: card.back,
              },
            })
          )
        );

        return {
          success: true,
          cardsCreated: createdCards.length,
          cards: createdCards,
        };
      } catch (error) {
        console.error("Error generating flashcards:", error);
        return {
          error: "Failed to generate flashcards",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      body: t.Object({
        topic: t.String({ minLength: 1 }),
        count: t.Optional(t.Number({ minimum: 1, maximum: 50 })),
        difficulty: t.Optional(t.Enum({ beginner: "beginner", intermediate: "intermediate", advanced: "advanced" })),
        language: t.Optional(t.Enum({ ja: "ja", en: "en" })),
      }),
    }
  );
