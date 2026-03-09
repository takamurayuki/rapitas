/**
 * Flashcards API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../../config/database";
import { decrypt } from "../../utils/encryption";
import { createLogger } from "../../config/logger";
import { NotFoundError, ValidationError, AppError, parseId } from '../../middleware/error-handler';
import { fsrs, generatorParameters, createEmptyCard, Rating, State, type Card, type Grade } from "ts-fsrs";

const log = createLogger("routes:flashcards");

// FSRS scheduler instance
const f = fsrs(generatorParameters());

// Map SM-2 quality (0-5) to FSRS Rating (1-4)
function qualityToRating(quality: number): Grade {
  if (quality <= 1) return Rating.Again; // 1
  if (quality === 2) return Rating.Hard;  // 2
  if (quality === 3) return Rating.Good;  // 3
  return Rating.Easy; // 4
}

// Convert DB flashcard to FSRS Card object
function toFsrsCard(dbCard: {
  stability: number;
  difficulty: number;
  state: number;
  reviewCount: number;
  lapses: number;
  lastReview: Date | null;
  nextReview: Date | null;
  interval: number;
  easeFactor: number;
}): Card {
  // For new cards (state=0, stability=0), return empty card
  if (dbCard.state === 0 && dbCard.stability === 0) {
    return createEmptyCard();
  }

  return {
    due: dbCard.nextReview || new Date(),
    stability: dbCard.stability,
    difficulty: dbCard.difficulty,
    elapsed_days: 0,
    scheduled_days: dbCard.interval,
    reps: dbCard.reviewCount,
    lapses: dbCard.lapses,
    learning_steps: 0,
    state: dbCard.state as State,
    last_review: dbCard.lastReview || undefined,
  };
}

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
  .get("/flashcard-decks", async ({ query }) => {
    const learningGoalId = query?.learningGoalId ? parseInt(query.learningGoalId as string) : undefined;
    return await prisma.flashcardDeck.findMany({
      where: {
        ...(learningGoalId && { learningGoalId }),
      },
      include: {
        _count: { select: { cards: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  })

  .get("/flashcard-decks/:id", async ({ params }) => {
    const id = parseId(params.id);
    const deck = await prisma.flashcardDeck.findUnique({
      where: { id },
      include: {
        cards: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!deck) throw new NotFoundError("Deck not found");
    return deck;
  })

  .post(
    "/flashcard-decks",
    async (context) => {
      const { body } = context as { body: { name: string; description?: string; color?: string; taskId?: number } };
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
    }
  )

  .delete("/flashcard-decks/:id", async ({ params }) => {
    const id = parseId(params.id);
    return await prisma.flashcardDeck.delete({ where: { id } });
  })

  .post(
    "/flashcard-decks/:deckId/cards",
    async (context) => {
      const { deckId } = context.params as { deckId: string };
      const { front, back } = context.body as { front: string; back: string };
      const deckIdNum = parseId(deckId, "deckId");
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
    }
  )

  .patch(
    "/flashcards/:id",
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
    }
  )

  .delete("/flashcards/:id", async ({ params }) => {
    const id = parseId(params.id);
    return await prisma.flashcard.delete({ where: { id } });
  })

  // フラッシュカード復習（FSRSアルゴリズム）
  .post(
    "/flashcards/:id/review",
    async (context) => {
      const id = parseId(context.params.id);
      const { quality } = context.body as { quality: number }; // 0-5 scale (mapped to FSRS Rating 1-4)

      const card = await prisma.flashcard.findUnique({
        where: { id },
      });
      if (!card) throw new NotFoundError("Card not found");

      const now = new Date();
      const fsrsCard = toFsrsCard(card);
      const rating = qualityToRating(quality);

      // FSRS scheduling
      const schedulingResult = f.repeat(fsrsCard, now);
      const result = schedulingResult[rating];
      const updatedCard = result.card;

      return await prisma.flashcard.update({
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
    },
    {
      body: t.Object({
        quality: t.Number({ minimum: 0, maximum: 5 }),
      }),
    }
  )

  // FSRSスケジューリングプレビュー（各Rating選択時の次回復習日を返す）
  .get("/flashcards/:id/schedule-preview", async ({ params }) => {
    const id = parseId(params.id);
    const card = await prisma.flashcard.findUnique({ where: { id } });
    if (!card) throw new NotFoundError("Card not found");

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
    async (context) => {
      const deckId = parseId(context.params.deckId, "deckId");
      const { topic, count = 10, difficulty = "intermediate", language = "ja" } = context.body as {
        topic: string;
        count?: number;
        difficulty?: string;
        language?: string;
      };

      // デッキの存在確認
      const deck = await prisma.flashcardDeck.findUnique({
        where: { id: deckId },
      });
      if (!deck) {
        throw new NotFoundError("Deck not found");
      }

      // APIキーの取得
      const settings = await prisma.userSettings.findFirst();
      let apiKey: string | undefined;

      if (settings?.claudeApiKeyEncrypted) {
        try {
          apiKey = decrypt(settings.claudeApiKeyEncrypted);
        } catch (error) {
          log.error({ err: error }, "Failed to decrypt API key");
          throw new AppError(500, "Failed to decrypt API key");
        }
      } else {
        apiKey = process.env.CLAUDE_API_KEY;
      }

      if (!apiKey) {
        throw new ValidationError("API key not configured");
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
        log.error({ err: error }, "Error generating flashcards");
        if (error instanceof AppError) throw error;
        throw new AppError(500, "Failed to generate flashcards");
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
  )

  // ノートテキストからフラッシュカードを生成（新規デッキ作成 or 既存デッキに追加）
  .post(
    "/flashcards/generate-from-text",
    async (context) => {
      const { text, deckName, deckId, count = 10, language = "ja" } = context.body as {
        text: string;
        deckName?: string;
        deckId?: number;
        count?: number;
        language?: string;
      };

      if (!text || text.trim().length < 10) {
        throw new ValidationError("Text content is too short for flashcard generation");
      }

      // APIキーの取得
      const settings = await prisma.userSettings.findFirst();
      let apiKey: string | undefined;

      if (settings?.claudeApiKeyEncrypted) {
        try {
          apiKey = decrypt(settings.claudeApiKeyEncrypted);
        } catch (error) {
          log.error({ err: error }, "Failed to decrypt API key");
          throw new AppError(500, "Failed to decrypt API key");
        }
      } else {
        apiKey = process.env.CLAUDE_API_KEY;
      }

      if (!apiKey) {
        throw new ValidationError("API key not configured");
      }

      // デッキの準備（既存 or 新規作成）
      let targetDeckId: number;
      if (deckId) {
        const deck = await prisma.flashcardDeck.findUnique({ where: { id: deckId } });
        if (!deck) throw new NotFoundError("Deck not found");
        targetDeckId = deckId;
      } else {
        const newDeck = await prisma.flashcardDeck.create({
          data: {
            name: deckName || (language === "ja" ? "ノートから生成" : "Generated from notes"),
            description: language === "ja" ? "ノートの内容から自動生成されたフラッシュカード" : "Flashcards auto-generated from note content",
            color: "#8B5CF6",
          },
        });
        targetDeckId = newDeck.id;
      }

      try {
        // HTMLタグを除去してプレーンテキストに変換
        const plainText = text
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, " ")
          .trim();

        // 文字数制限（トークン制限対策）
        const truncatedText = plainText.slice(0, 8000);

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
                content: language === "ja"
                  ? `以下のテキストからフラッシュカードを${count}枚作成してください。

テキスト内容の重要な概念、用語、事実を抽出し、学習に最適なQ&Aペアを作成してください。

条件：
- テキストに含まれる情報のみを使用（外部知識は最小限に）
- 質問は具体的で、回答は簡潔かつ正確に
- 理解度を確認できる質問を優先（「〜とは何か」「〜の違いは」「〜の理由は」など）
- 段階的に基礎→応用の順で並べる

以下のJSON形式のみで出力（余計なテキスト不要）：
{"cards":[{"front":"質問","back":"回答"}]}

テキスト：
${truncatedText}`
                  : `Create ${count} flashcards from the following text.

Extract key concepts, terms, and facts from the text and create optimal Q&A pairs for learning.

Requirements:
- Use only information from the text (minimize external knowledge)
- Questions should be specific, answers concise and accurate
- Prioritize comprehension-checking questions ("What is...", "How does... differ from...", "Why...")
- Order from basic to advanced concepts

Output ONLY in the following JSON format (no extra text):
{"cards":[{"front":"Question","back":"Answer"}]}

Text:
${truncatedText}`,
              },
            ],
          }),
        });

        if (!response.ok) {
          throw new Error(`API request failed: ${response.statusText}`);
        }

        const data = await response.json() as ClaudeAPIResponse;
        const content = data.content[0].text;

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error("Failed to parse AI response");
        }

        const generatedData = JSON.parse(jsonMatch[0]);
        const cards = generatedData.cards;

        if (!Array.isArray(cards) || cards.length === 0) {
          throw new Error("No cards generated");
        }

        const createdCards = await Promise.all(
          cards.map((card: { front: string; back: string }) =>
            prisma.flashcard.create({
              data: {
                deckId: targetDeckId,
                front: card.front,
                back: card.back,
              },
            })
          )
        );

        const deck = await prisma.flashcardDeck.findUnique({
          where: { id: targetDeckId },
          include: { _count: { select: { cards: true } } },
        });

        return {
          success: true,
          deckId: targetDeckId,
          deckName: deck?.name,
          cardsCreated: createdCards.length,
          cards: createdCards,
        };
      } catch (error) {
        log.error({ err: error }, "Error generating flashcards from text");
        if (error instanceof AppError) throw error;
        throw new AppError(500, "Failed to generate flashcards from text");
      }
    },
    {
      body: t.Object({
        text: t.String({ minLength: 10 }),
        deckName: t.Optional(t.String()),
        deckId: t.Optional(t.Number()),
        count: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
        language: t.Optional(t.String()),
      }),
    }
  );
