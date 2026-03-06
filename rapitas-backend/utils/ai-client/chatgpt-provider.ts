/**
 * OpenAI (ChatGPT) APIプロバイダー
 */
import { type AIMessage, type AIResponse } from "./types";
import { formatApiError } from "./error-handler";

/**
 * OpenAI (ChatGPT) APIを呼び出す（非ストリーミング）
 */
export async function callChatGPT(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<AIResponse> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey });

  const chatMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];

  if (systemPrompt) {
    chatMessages.push({ role: "system", content: systemPrompt });
  }

  for (const m of messages) {
    chatMessages.push({ role: m.role, content: m.content });
  }

  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: chatMessages,
  });

  const content = response.choices[0]?.message?.content || "";
  const tokensUsed =
    (response.usage?.prompt_tokens || 0) +
    (response.usage?.completion_tokens || 0);

  return { content, tokensUsed };
}

/**
 * OpenAI ストリーミング呼び出し
 */
export async function callChatGPTStream(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<ReadableStream> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey });

  const chatMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];

  if (systemPrompt) {
    chatMessages.push({ role: "system", content: systemPrompt });
  }
  for (const m of messages) {
    chatMessages.push({ role: m.role, content: m.content });
  }

  return new ReadableStream({
    async start(controller) {
      try {
        const stream = await client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          messages: chatMessages,
          stream: true,
        });

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            const data = JSON.stringify({ content });
            controller.enqueue(
              new TextEncoder().encode(`data: ${data}\n\n`),
            );
          }
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error: unknown) {
        const errorData = JSON.stringify({
          error: formatApiError(error, "chatgpt"),
        });
        controller.enqueue(
          new TextEncoder().encode(`data: ${errorData}\n\n`),
        );
        controller.close();
      }
    },
  });
}
