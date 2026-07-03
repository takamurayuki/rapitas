/**
 * AI Chat API Routes
 * Multi-provider support (Claude / ChatGPT / Gemini)
 */
import { Elysia, t } from 'elysia';
import {
  sendAIMessage,
  sendAIMessageStream,
  getConfiguredProviders,
  type AIProvider,
  type AIMessage,
} from '../../utils/ai-client';
import { createLogger } from '../../config/logger';
import { aiRateLimiter } from '../../middleware/rate-limiter';

const log = createLogger('routes:ai-chat');

// Shared body schema for /ai/chat and /ai/chat/stream — both accept the same
// chat payload shape. maxLength/maxItems bound an otherwise-unbounded chat
// message and history array. The message cap matches the handler's own
// 100,000-char limit exactly (kept as defense-in-depth) so the schema never
// rejects a payload the handler would have accepted.
const chatBodySchema = t.Object(
  {
    message: t.String({ maxLength: 100_000 }),
    conversationHistory: t.Optional(
      t.Array(
        t.Object(
          { role: t.String({ maxLength: 50 }), content: t.String({ maxLength: 100_000 }) },
          { additionalProperties: false },
        ),
        { maxItems: 200 },
      ),
    ),
    systemPrompt: t.Optional(t.String({ maxLength: 100_000 })),
    provider: t.Optional(t.String({ maxLength: 100 })),
    model: t.Optional(t.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);

export const aiChatRoutes = new Elysia()
  .post(
    '/ai/chat',
    async (context) => {
      const { body, set } = context;
      const ip = context.headers?.['x-forwarded-for'] || 'local';
      if (
        !aiRateLimiter(set as { status?: number | string; headers: Record<string, string> }, ip)
      ) {
        return { error: 'リクエストが多すぎます。しばらくしてから再試行してください。' };
      }
      const {
        message,
        conversationHistory = [],
        systemPrompt,
        provider,
        model,
      } = body as {
        message: string;
        conversationHistory?: Array<{ role: string; content: string }>;
        systemPrompt?: string;
        provider?: string;
        model?: string;
      };

      if (!message || message.trim() === '') {
        set.status = 400;
        return { error: 'メッセージが必要です' };
      }

      // AI input size limit (100KB)
      if (message.length > 100_000) {
        set.status = 400;
        return { error: 'メッセージが長すぎます（最大100,000文字）' };
      }

      const aiProvider = (provider || 'claude') as AIProvider;

      try {
        const messages: AIMessage[] = [
          ...conversationHistory.map((msg) => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content,
          })),
          { role: 'user' as const, content: message },
        ];

        const defaultSystemPrompt = `あなたはRapi+アプリケーションのAIアシスタントです。
ユーザーのタスク管理や学習に関する質問に日本語で丁寧に回答してください。
簡潔で分かりやすい回答を心がけてください。`;

        const response = await sendAIMessage({
          provider: aiProvider,
          model: model || undefined,
          messages,
          systemPrompt: systemPrompt || defaultSystemPrompt,
        });

        return { success: true, message: response.content };
      } catch (error: unknown) {
        log.error({ err: error }, 'AI Chat Error');
        set.status = 500;
        return {
          error: error instanceof Error ? error.message : 'AIとの通信中にエラーが発生しました',
        };
      }
    },
    {
      body: chatBodySchema,
    },
  )

  .post(
    '/ai/chat/stream',
    async (context) => {
      const { body, set } = context;
      const ip = context.headers?.['x-forwarded-for'] || 'local';
      if (
        !aiRateLimiter(set as { status?: number | string; headers: Record<string, string> }, ip)
      ) {
        return { error: 'リクエストが多すぎます。しばらくしてから再試行してください。' };
      }
      const {
        message,
        conversationHistory = [],
        systemPrompt,
        provider,
        model,
      } = body as {
        message: string;
        conversationHistory?: Array<{ role: string; content: string }>;
        systemPrompt?: string;
        provider?: string;
        model?: string;
      };

      if (!message || message.trim() === '') {
        set.status = 400;
        return { error: 'メッセージが必要です' };
      }

      // AI input size limit (100KB)
      if (message.length > 100_000) {
        set.status = 400;
        return { error: 'メッセージが長すぎます（最大100,000文字）' };
      }

      const aiProvider = (provider || 'claude') as AIProvider;

      set.headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      };

      const defaultSystemPrompt = `あなたはRapi+アプリケーションのAIアシスタントです。
ユーザーのタスク管理や学習に関する質問に日本語で丁寧に回答してください。
簡潔で分かりやすい回答を心がけてください。`;

      const messages: AIMessage[] = [
        ...conversationHistory.map((msg) => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        })),
        { role: 'user' as const, content: message },
      ];

      try {
        const stream = await sendAIMessageStream({
          provider: aiProvider,
          model: model || undefined,
          messages,
          systemPrompt: systemPrompt || defaultSystemPrompt,
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      } catch (error: unknown) {
        log.error({ err: error }, 'AI Chat Stream Error');
        set.status = 500;
        return {
          error: error instanceof Error ? error.message : 'AIとの通信中にエラーが発生しました',
        };
      }
    },
    {
      body: chatBodySchema,
    },
  )

  .get('/ai/providers', async () => {
    const configured = await getConfiguredProviders();
    return { providers: configured };
  });
