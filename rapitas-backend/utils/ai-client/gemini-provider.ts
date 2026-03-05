/**
 * Google Gemini APIプロバイダー
 */
import { type AIMessage, type AIResponse } from "./types";
import { formatApiError } from "./error-handler";

/**
 * Google Gemini APIを呼び出す（非ストリーミング）
 */
export async function callGemini(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<AIResponse> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);

  const generativeModel = genAI.getGenerativeModel({
    model,
    ...(systemPrompt
      ? { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
      : {}),
    generationConfig: {
      maxOutputTokens: maxTokens,
    },
  });

  // Gemini のチャット形式に変換
  const history = messages
    .filter((m) => m.role !== "system")
    .slice(0, -1)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const lastMessage = messages.filter((m) => m.role !== "system").slice(-1)[0];
  if (!lastMessage) {
    return { content: "", tokensUsed: 0 };
  }

  const chat = generativeModel.startChat({ history });
  const result = await chat.sendMessage(lastMessage.content);
  const response = result.response;
  const content = response.text();

  // Gemini はトークン使用量の取得方法が異なる
  const tokensUsed =
    (response.usageMetadata?.promptTokenCount || 0) +
    (response.usageMetadata?.candidatesTokenCount || 0);

  return { content, tokensUsed };
}

/**
 * Gemini ストリーミング呼び出し
 */
export async function callGeminiStream(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<ReadableStream> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);

  const generativeModel = genAI.getGenerativeModel({
    model,
    ...(systemPrompt
      ? { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
      : {}),
    generationConfig: {
      maxOutputTokens: maxTokens,
    },
  });

  const history = messages
    .filter((m) => m.role !== "system")
    .slice(0, -1)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const lastMessage = messages.filter((m) => m.role !== "system").slice(-1)[0];

  return new ReadableStream({
    async start(controller) {
      try {
        if (!lastMessage) {
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        const chat = generativeModel.startChat({ history });
        const result = await chat.sendMessageStream(lastMessage.content);

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            const data = JSON.stringify({ content: text });
            controller.enqueue(
              new TextEncoder().encode(`data: ${data}\n\n`),
            );
          }
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error: unknown) {
        const errorData = JSON.stringify({
          error: formatApiError(error, "gemini"),
        });
        controller.enqueue(
          new TextEncoder().encode(`data: ${errorData}\n\n`),
        );
        controller.close();
      }
    },
  });
}
