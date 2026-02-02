/**
 * AI Chat API Routes
 */
import { Elysia } from "elysia";
import { prisma } from "../config/database";
import { encrypt, decrypt, maskApiKey } from "../utils/encryption";

export const aiChatRoutes = new Elysia()
  // AIチャット（非ストリーミング）
  .post(
    "/ai/chat",
    async ({
      body,
      set,
    }: {
      body: {
        message: string;
        conversationHistory?: Array<{ role: string; content: string }>;
        systemPrompt?: string;
      };
      set: { status: number };
    }) => {
      const { message, conversationHistory = [], systemPrompt } = body;

      if (!message || message.trim() === "") {
        set.status = 400;
        return { error: "メッセージが必要です" };
      }

      // APIキーの確認
      const settings = await prisma.userSettings.findFirst();
      if (!settings?.claudeApiKeyEncrypted) {
        set.status = 400;
        return {
          error:
            "APIキーが設定されていません。設定画面でClaude APIキーを設定してください。",
        };
      }

      let apiKey: string;
      try {
        apiKey = decrypt(settings.claudeApiKeyEncrypted);
      } catch {
        set.status = 500;
        return { error: "APIキーの復号化に失敗しました" };
      }

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey });

      const defaultSystemPrompt = `あなたはRapi+アプリケーションのAIアシスタントです。
ユーザーのタスク管理や学習計画に関する質問に日本語で丁寧に回答してください。
簡潔で分かりやすい回答を心がけてください。`;

      try {
        const messages = [
          ...conversationHistory.map((msg) => ({
            role: msg.role as "user" | "assistant",
            content: msg.content,
          })),
          { role: "user" as const, content: message },
        ];

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: systemPrompt || defaultSystemPrompt,
          messages,
        });

        const content = response.content[0];
        if (content.type === "text") {
          return { success: true, message: content.text };
        }

        return { success: true, message: "" };
      } catch (error: unknown) {
        console.error("AI Chat Error:", error);
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
    async ({
      body,
      set,
    }: {
      body: {
        message: string;
        conversationHistory?: Array<{ role: string; content: string }>;
        systemPrompt?: string;
      };
      set: { headers: Record<string, string>; status: number };
    }) => {
      const { message, conversationHistory = [], systemPrompt } = body;

      if (!message || message.trim() === "") {
        set.status = 400;
        return { error: "メッセージが必要です" };
      }

      // APIキーの確認
      const settings = await prisma.userSettings.findFirst();
      if (!settings?.claudeApiKeyEncrypted) {
        set.status = 400;
        return {
          error:
            "APIキーが設定されていません。設定画面でClaude APIキーを設定してください。",
        };
      }

      let apiKey: string;
      try {
        apiKey = decrypt(settings.claudeApiKeyEncrypted);
      } catch {
        set.status = 500;
        return { error: "APIキーの復号化に失敗しました" };
      }

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey });

      const defaultSystemPrompt = `あなたはRapi+アプリケーションのAIアシスタントです。
ユーザーのタスク管理や学習計画に関する質問に日本語で丁寧に回答してください。
簡潔で分かりやすい回答を心がけてください。`;

      set.headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      };

      const messages = [
        ...conversationHistory.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
        { role: "user" as const, content: message },
      ];

      return new Response(
        new ReadableStream({
          async start(controller) {
            try {
              const stream = anthropic.messages.stream({
                model: "claude-sonnet-4-20250514",
                max_tokens: 2048,
                system: systemPrompt || defaultSystemPrompt,
                messages,
              });

              for await (const event of stream) {
                if (
                  event.type === "content_block_delta" &&
                  event.delta.type === "text_delta"
                ) {
                  const data = JSON.stringify({ content: event.delta.text });
                  controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
                }
              }

              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              controller.close();
            } catch (error: unknown) {
              console.error("AI Chat Stream Error:", error);
              const errorData = JSON.stringify({
                error:
                  error instanceof Error
                    ? error.message
                    : "AIとの通信中にエラーが発生しました",
              });
              controller.enqueue(new TextEncoder().encode(`data: ${errorData}\n\n`));
              controller.close();
            }
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  )

  // APIキーの保存（暗号化）
  .post("/settings/api-key", async ({ body }: { body: { apiKey: string } }) => {
    const { apiKey } = body;

    if (!apiKey || apiKey.trim() === "") {
      return { error: "APIキーが必要です" };
    }

    // 暗号化
    const encryptedKey = encrypt(apiKey);

    // 設定を取得または作成
    let settings = await prisma.userSettings.findFirst();
    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {
          claudeApiKeyEncrypted: encryptedKey,
        },
      });
    } else {
      settings = await prisma.userSettings.update({
        where: { id: settings.id },
        data: {
          claudeApiKeyEncrypted: encryptedKey,
        },
      });
    }

    return {
      success: true,
      maskedKey: maskApiKey(apiKey),
    };
  })

  // マスクされたAPIキーを取得
  .get("/settings/api-key", async () => {
    const settings = await prisma.userSettings.findFirst();

    if (!settings?.claudeApiKeyEncrypted) {
      return {
        configured: false,
        maskedKey: null,
      };
    }

    try {
      const decryptedKey = decrypt(settings.claudeApiKeyEncrypted);
      return {
        configured: true,
        maskedKey: maskApiKey(decryptedKey),
      };
    } catch {
      return {
        configured: false,
        maskedKey: null,
        error: "復号化に失敗しました",
      };
    }
  })

  // APIキーの削除
  .delete("/settings/api-key", async () => {
    const settings = await prisma.userSettings.findFirst();

    if (!settings) {
      return { success: true };
    }

    await prisma.userSettings.update({
      where: { id: settings.id },
      data: {
        claudeApiKeyEncrypted: null,
      },
    });

    return { success: true };
  });
