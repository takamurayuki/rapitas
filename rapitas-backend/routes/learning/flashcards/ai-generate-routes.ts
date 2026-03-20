/**
 * FlashcardAiGenerateRoutes
 *
 * Routes for AI-powered flashcard generation: topic-based generation and
 * generation from arbitrary note text. Both routes call the Claude API.
 *
 * Not responsible for CRUD or FSRS scheduling; see crud-routes.ts for those.
 * Prompt strings live in ai-prompts.ts to keep this file concise.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { decrypt } from '../../../utils/encryption';
import { createLogger } from '../../../config/logger';
import { NotFoundError, ValidationError, AppError, parseId } from '../../../middleware/error-handler';
import { type ClaudeAPIResponse } from './fsrs-helpers';
import { buildTopicPrompt, buildTextPrompt, sanitiseAndTruncate } from './ai-prompts';

const log = createLogger('routes:flashcards');

/**
 * Resolves the Claude API key from the database or environment variable.
 *
 * @param logger - Logger instance / ロガーインスタンス
 * @returns Resolved API key string / 解決済みAPIキー文字列
 * @throws {AppError} If the key cannot be decrypted / キーが復号できない場合
 * @throws {ValidationError} If no API key is configured / APIキーが設定されていない場合
 */
async function resolveApiKey(logger: ReturnType<typeof createLogger>): Promise<string> {
  const settings = await prisma.userSettings.findFirst();
  let apiKey: string | undefined;

  if (settings?.claudeApiKeyEncrypted) {
    try {
      apiKey = decrypt(settings.claudeApiKeyEncrypted);
    } catch (error) {
      logger.error({ err: error }, 'Failed to decrypt API key');
      throw new AppError(500, 'Failed to decrypt API key');
    }
  } else {
    apiKey = process.env.CLAUDE_API_KEY;
  }

  if (!apiKey) throw new ValidationError('API key not configured');
  return apiKey;
}

/**
 * Calls the Claude API with the given prompt and parses the returned JSON card array.
 *
 * @param apiKey - Resolved Claude API key / 解決済みClaude APIキー
 * @param prompt - User-role message content to send / 送信するユーザーロールメッセージ内容
 * @returns Parsed array of {front, back} card objects / パースされた{front, back}カード配列
 * @throws {Error} On non-OK HTTP response or unparseable JSON / HTTPエラーまたはJSONパース失敗時
 */
async function callClaudeForCards(
  apiKey: string,
  prompt: string,
): Promise<Array<{ front: string; back: string }>> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`API request failed: ${response.statusText}`);

  const data = (await response.json()) as ClaudeAPIResponse;
  const content = data.content[0].text;

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse AI response');

  const generatedData = JSON.parse(jsonMatch[0]);
  const cards = generatedData.cards;

  if (!Array.isArray(cards) || cards.length === 0) throw new Error('No cards generated');
  return cards as Array<{ front: string; back: string }>;
}

export const flashcardAiGenerateRoutes = new Elysia()
  // Auto-generate flashcards from a topic string using AI
  .post(
    '/flashcard-decks/:deckId/generate',
    async (context) => {
      const deckId = parseId(context.params.deckId, 'deckId');
      const {
        topic,
        count = 10,
        difficulty = 'intermediate',
        language = 'ja',
      } = context.body as {
        topic: string;
        count?: number;
        difficulty?: string;
        language?: string;
      };

      const deck = await prisma.flashcardDeck.findUnique({ where: { id: deckId } });
      if (!deck) throw new NotFoundError('Deck not found');

      const apiKey = await resolveApiKey(log);
      const prompt = buildTopicPrompt(topic, count, difficulty, language);

      try {
        const cards = await callClaudeForCards(apiKey, prompt);
        const createdCards = await Promise.all(
          cards.map((card) =>
            prisma.flashcard.create({ data: { deckId, front: card.front, back: card.back } }),
          ),
        );
        return { success: true, cardsCreated: createdCards.length, cards: createdCards };
      } catch (error) {
        log.error({ err: error }, 'Error generating flashcards');
        if (error instanceof AppError) throw error;
        throw new AppError(500, 'Failed to generate flashcards');
      }
    },
    {
      body: t.Object({
        topic: t.String({ minLength: 1 }),
        count: t.Optional(t.Number({ minimum: 1, maximum: 50 })),
        difficulty: t.Optional(
          t.Enum({ beginner: 'beginner', intermediate: 'intermediate', advanced: 'advanced' }),
        ),
        language: t.Optional(t.Enum({ ja: 'ja', en: 'en' })),
      }),
    },
  )

  // Generate flashcards from note text (create new deck or add to existing)
  .post(
    '/flashcards/generate-from-text',
    async (context) => {
      const {
        text,
        deckName,
        deckId,
        count = 10,
        language = 'ja',
        difficulty = 'intermediate',
      } = context.body as {
        text: string;
        deckName?: string;
        deckId?: number;
        count?: number;
        language?: string;
        difficulty?: string;
      };

      if (!text || text.trim().length < 10) {
        throw new ValidationError('Text content is too short for flashcard generation');
      }

      const apiKey = await resolveApiKey(log);

      // Prepare target deck (use existing or create new)
      let targetDeckId: number;
      if (deckId) {
        const deck = await prisma.flashcardDeck.findUnique({ where: { id: deckId } });
        if (!deck) throw new NotFoundError('Deck not found');
        targetDeckId = deckId;
      } else {
        const newDeck = await prisma.flashcardDeck.create({
          data: {
            name: deckName || (language === 'ja' ? 'ノートから生成' : 'Generated from notes'),
            description:
              language === 'ja'
                ? 'ノートの内容から自動生成されたフラッシュカード'
                : 'Flashcards auto-generated from note content',
            color: '#8B5CF6',
          },
        });
        targetDeckId = newDeck.id;
      }

      const plainText = sanitiseAndTruncate(text);
      const prompt = buildTextPrompt(plainText, count, difficulty, language);

      try {
        const cards = await callClaudeForCards(apiKey, prompt);
        const createdCards = await Promise.all(
          cards.map((card) =>
            prisma.flashcard.create({
              data: { deckId: targetDeckId, front: card.front, back: card.back },
            }),
          ),
        );

        const updatedDeck = await prisma.flashcardDeck.findUnique({
          where: { id: targetDeckId },
          include: { _count: { select: { cards: true } } },
        });

        return {
          success: true,
          deckId: targetDeckId,
          deckName: updatedDeck?.name,
          cardsCreated: createdCards.length,
          cards: createdCards,
        };
      } catch (error) {
        log.error({ err: error }, 'Error generating flashcards from text');
        if (error instanceof AppError) throw error;
        throw new AppError(500, 'Failed to generate flashcards from text');
      }
    },
    {
      body: t.Object({
        text: t.String({ minLength: 10 }),
        deckName: t.Optional(t.String()),
        deckId: t.Optional(t.Number()),
        count: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
        language: t.Optional(t.String()),
        difficulty: t.Optional(
          t.Enum({ beginner: 'beginner', intermediate: 'intermediate', advanced: 'advanced' }),
        ),
      }),
    },
  );
