import type { AIChatMessage, AIServiceResponse } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export type SendMessageOptions = {
  message: string;
  conversationHistory?: AIChatMessage[];
  systemPrompt?: string;
};

/**
 * Claude APIを通じてAIにメッセージを送信し、応答を取得する
 * バックエンドのプロキシエンドポイントを経由してAPIキーを安全に管理
 */
export async function sendMessageToAI(
  options: SendMessageOptions
): Promise<AIServiceResponse> {
  const { message, conversationHistory = [], systemPrompt } = options;

  try {
    const response = await fetch(`${API_BASE}/ai/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        conversationHistory: conversationHistory.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        systemPrompt,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `APIエラー: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    return {
      success: true,
      message: data.message || data.content,
    };
  } catch (error) {
    console.error("AI API Error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "AIとの通信中にエラーが発生しました",
    };
  }
}

/**
 * ストリーミングレスポンスでAIにメッセージを送信する
 * リアルタイムで応答を受け取りたい場合に使用
 */
export async function sendMessageToAIStream(
  options: SendMessageOptions,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: string) => void
): Promise<void> {
  const { message, conversationHistory = [], systemPrompt } = options;

  try {
    const response = await fetch(`${API_BASE}/ai/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        conversationHistory: conversationHistory.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        systemPrompt,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `APIエラー: ${response.status} ${response.statusText}`
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("レスポンスストリームを取得できませんでした");
    }

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            onComplete();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              onChunk(parsed.content);
            }
          } catch {
            // JSONでない場合はそのままテキストとして扱う
            if (data.trim()) {
              onChunk(data);
            }
          }
        }
      }
    }

    onComplete();
  } catch (error) {
    console.error("AI Stream Error:", error);
    onError(
      error instanceof Error
        ? error.message
        : "AIとの通信中にエラーが発生しました"
    );
  }
}
