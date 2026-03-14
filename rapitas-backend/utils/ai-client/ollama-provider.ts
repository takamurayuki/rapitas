/**
 * ローカルLLMプロバイダー (OpenAI互換API)
 * Ollama / llama-server の両方に対応
 * 両者とも /v1/chat/completions エンドポイントを提供する
 */
import { createLogger } from '../../config/logger';
import type { AIMessage, AIResponse } from './types';

const log = createLogger('ai-client:ollama');

/**
 * ローカルLLMサーバーの接続確認
 */
export async function checkOllamaConnection(baseUrl: string): Promise<{
  connected: boolean;
  models: string[];
  serverType: 'ollama' | 'llama-server' | 'unknown';
  error?: string;
}> {
  // まずOllamaの /api/tags を試す
  try {
    const ollamaRes = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (ollamaRes.ok) {
      const data = (await ollamaRes.json()) as { models?: Array<{ name: string }> };
      const models = (data.models || []).map((m) => m.name);
      return { connected: true, models, serverType: 'ollama' };
    }
  } catch {
    // Ollamaではない可能性、次を試す
  }

  // llama-server の /v1/models を試す
  try {
    const llamaRes = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (llamaRes.ok) {
      const data = (await llamaRes.json()) as { data?: Array<{ id: string }> };
      const models = (data.data || []).map((m) => m.id);
      return { connected: true, models, serverType: 'llama-server' };
    }
  } catch {
    // llama-serverでもない
  }

  return {
    connected: false,
    models: [],
    serverType: 'unknown',
    error: `${baseUrl} に接続できません`,
  };
}

/**
 * OpenAI互換API呼び出し（非ストリーミング）
 * Ollama / llama-server の両方で動作
 */
export async function callOllama(
  baseUrl: string,
  model: string,
  messages: AIMessage[],
  systemPrompt?: string,
  maxTokens?: number,
): Promise<AIResponse> {
  const chatMessages: Array<{ role: string; content: string }> = [];

  if (systemPrompt) {
    chatMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    chatMessages.push({ role: msg.role, content: msg.content });
  }

  log.info(`Calling local LLM at ${baseUrl} with model ${model}`);

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: chatMessages,
      max_tokens: maxTokens || 256,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Local LLM API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content: string } }>;
    usage?: { total_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Local LLM returned empty response');
  }

  return {
    content,
    tokensUsed: data.usage?.total_tokens || 0,
  };
}

/**
 * OpenAI互換API呼び出し（ストリーミング）
 */
export async function callOllamaStream(
  baseUrl: string,
  model: string,
  messages: AIMessage[],
  systemPrompt?: string,
  maxTokens?: number,
): Promise<ReadableStream> {
  const chatMessages: Array<{ role: string; content: string }> = [];

  if (systemPrompt) {
    chatMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    chatMessages.push({ role: msg.role, content: msg.content });
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: chatMessages,
      max_tokens: maxTokens || 2048,
      temperature: 0.7,
      stream: true,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Local LLM API error (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error('Local LLM returned no stream body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;

        try {
          const json = JSON.parse(jsonStr) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            controller.enqueue(new TextEncoder().encode(content));
          }
        } catch {
          // skip invalid JSON
        }
      }
    },
  });
}
