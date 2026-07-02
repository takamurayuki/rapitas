import type { AIChatMessage, AIServiceResponse, ApiProvider } from '@/types';
import { API_BASE_URL as API_BASE } from '@/utils/api';
import { createLogger } from '@/lib/logger';
const logger = createLogger('aiService');

export type SendMessageOptions = {
  message: string;
  conversationHistory?: AIChatMessage[];
  systemPrompt?: string;
  provider?: ApiProvider;
  model?: string;
};

/**
 * Localized error strings for this module's fallback messages (used when the
 * backend didn't send a specific error). This module has no hook access, so
 * the caller (useAIChat) builds these from `useTranslations` and passes them in.
 */
export interface AIServiceMessages {
  /** Fallback error text when a non-OK response carries no `error` field. */
  apiError: (status: number, statusText: string) => string;
  /** Fallback error text for a thrown/network error with no message. */
  communicationError: string;
  /** Error text when the stream response body can't be read. */
  streamUnavailable: string;
}

/**
 * AIにメッセージを送信し、応答を取得する（マルチプロバイダー対応）
 */
export async function sendMessageToAI(
  options: SendMessageOptions,
  messages: AIServiceMessages,
): Promise<AIServiceResponse> {
  const { message, conversationHistory = [], systemPrompt, provider, model } = options;

  try {
    const response = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        conversationHistory: conversationHistory.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        systemPrompt,
        provider,
        model,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || messages.apiError(response.status, response.statusText));
    }

    const data = await response.json();
    return {
      success: true,
      message: data.message || data.content,
    };
  } catch (error) {
    logger.error('AI API Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : messages.communicationError,
    };
  }
}

/**
 * ストリーミングレスポンスでAIにメッセージを送信する（マルチプロバイダー対応）
 */
export async function sendMessageToAIStream(
  options: SendMessageOptions,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (error: string) => void,
  messages: AIServiceMessages,
): Promise<void> {
  const { message, conversationHistory = [], systemPrompt, provider, model } = options;

  try {
    const response = await fetch(`${API_BASE}/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        conversationHistory: conversationHistory.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        systemPrompt,
        provider,
        model,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || messages.apiError(response.status, response.statusText));
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error(messages.streamUnavailable);
    }

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            onComplete();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              onError(parsed.error);
              return;
            }
            if (parsed.content) {
              onChunk(parsed.content);
            }
          } catch {
            if (data.trim()) {
              onChunk(data);
            }
          }
        }
      }
    }

    onComplete();
  } catch (error) {
    logger.error('AI Stream Error:', error);
    onError(error instanceof Error ? error.message : messages.communicationError);
  }
}

/**
 * 設定済みのプロバイダー一覧を取得する
 */
export async function fetchConfiguredProviders(): Promise<ApiProvider[]> {
  try {
    const response = await fetch(`${API_BASE}/ai/providers`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.providers || [];
  } catch {
    return [];
  }
}

/**
 * 利用可能なモデル一覧を取得する
 */
export async function fetchAvailableModels(): Promise<
  Record<string, Array<{ value: string; label: string }>>
> {
  try {
    const response = await fetch(`${API_BASE}/settings/models`);
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}
