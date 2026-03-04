/**
 * AI Chat API Routes
 * マルチプロバイダー対応（Claude / ChatGPT / Gemini）
 */
import { Elysia, t } from "elysia";
import {
  sendAIMessage,
  sendAIMessageStream,
  getConfiguredProviders,
  type AIProvider,
  type AIMessage,
} from "../../utils/ai-client";
import { createLogger } from "../../config/logger";

const log = createLogger("routes:ai-chat");

export const aiChatRoutes = new Elysia()
  // AIチャット（非ストリーミング）
  .post(
    "/ai/chat",
    async (context) => {
      const { body, set } = context;
      const { message, conversationHistory = [], systemPrompt, provider, model  } = body as {
        message: string;
        conversationHistory?: Array<{ role: string; content: string }>;
        systemPrompt?: string;
        provider?: string;
        model?: string;
      };

      if (!message || message.trim() === "") {
        set.status = 400;
        return { error: "メッセージが必要です" };
      }

      // AI入力サイズ制限（100KB）
      if (message.length > 100_000) {
        set.status = 400;
        return { error: "メッセージが長すぎます（最大100,000文字）" };
      }

      const aiProvider = (provider || "claude") as AIProvider;

      try {
        const messages: AIMessage[] = [
          ...conversationHistory.map((msg) => ({
            role: msg.role as "user" | "assistant" | "system",
            content: msg.content,
          })),
          { role: "user" as const, content: message },
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
        log.error({ err: error }, "AI Chat Error");
        set.status = 500;
        return {
          error:
            error instanceof Error ? error.message : "AIとの通信中にエラーが発生しました",
        };
      }
    }
  )

  // AIチャット（ストリーミング）
  .post(
    "/ai/chat/stream",
    async (context) => {
      const { body, set } = context;
      const { message, conversationHistory = [], systemPrompt, provider, model } = body as {
        message: string;
        conversationHistory?: Array<{ role: string; content: string }>;
        systemPrompt?: string;
        provider?: string;
        model?: string;
      };

      if (!message || message.trim() === "") {
        set.status = 400;
        return { error: "メッセージが必要です" };
      }

      // AI入力サイズ制限（100KB）
      if (message.length > 100_000) {
        set.status = 400;
        return { error: "メッセージが長すぎます（最大100,000文字）" };
      }

      const aiProvider = (provider || "claude") as AIProvider;

      set.headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      };

      const defaultSystemPrompt = `あなたはRapi+アプリケーションのAIアシスタントです。
ユーザーのタスク管理や学習に関する質問に日本語で丁寧に回答してください。
簡潔で分かりやすい回答を心がけてください。`;

      const messages: AIMessage[] = [
        ...conversationHistory.map((msg) => ({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
        })),
        { role: "user" as const, content: message },
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
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (error: unknown) {
        log.error({ err: error }, "AI Chat Stream Error");
        set.status = 500;
        return {
          error:
            error instanceof Error ? error.message : "AIとの通信中にエラーが発生しました",
        };
      }
    }
  )

  // 設定済みプロバイダー一覧を取得
  .get("/ai/providers", async () => {
    const configured = await getConfiguredProviders();
    return { providers: configured };
  });
