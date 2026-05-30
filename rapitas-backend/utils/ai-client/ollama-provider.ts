/**
 * Local LLM Provider (OpenAI-compatible API)
 *
 * Supports both Ollama and llama-server.
 * Both expose the /v1/chat/completions endpoint.
 */
import { cpus } from 'os';
import { createLogger } from '../../config/logger';
import { Semaphore } from '../common/semaphore';
import type { AIMessage, AIResponse } from './types';

const log = createLogger('ai-client:ollama');

// Serialize local LLM inference app-wide. The model is CPU-bound, so letting
// multiple subsystems (copilot, idea enrichment, idea generation) infer at once
// saturates the machine and starves foreground HTTP requests. One at a time
// bounds the CPU footprint and keeps the server responsive under load.
const localInference = new Semaphore(1);

/** Port of the bundled llama-server sidecar (it only speaks the OpenAI API). */
const LLAMA_SERVER_PORT = 8922;
/** Keep the Ollama model resident this long so calls don't reload it (speed). */
const OLLAMA_KEEP_ALIVE = '30m';
/** Context window for local calls — enough for our prompts, modest on RAM. */
const OLLAMA_NUM_CTX = 4096;
// Cap inference threads to roughly half the cores so local LLM inference never
// grabs the whole machine and starves the (single-threaded) backend event loop.
// Critical on low-core CPU-only PCs running a 3B model.
const OLLAMA_NUM_THREAD = Math.max(1, Math.floor((cpus().length || 4) / 2));

/**
 * Check connectivity to a local LLM server.
 */
export async function checkOllamaConnection(baseUrl: string): Promise<{
  connected: boolean;
  models: string[];
  serverType: 'ollama' | 'llama-server' | 'unknown';
  error?: string;
}> {
  // Try Ollama's /api/tags first
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
    // intentionally ignored - connection may fail, try next server type
  }

  // Try llama-server's /v1/models
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
    // intentionally ignored - server may not be available
  }

  return {
    connected: false,
    models: [],
    serverType: 'unknown',
    error: `${baseUrl} に接続できません`,
  };
}

/**
 * OpenAI-compatible API call (non-streaming).
 * Works with both Ollama and llama-server.
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

  // Ollama exposes a native /api/chat that accepts keep_alive (keep the model
  // resident → no per-call reload) and tuning options. The bundled llama-server
  // sidecar only speaks the OpenAI-compatible /v1 API, so branch on its port.
  const isLlamaServer = baseUrl.includes(`:${LLAMA_SERVER_PORT}`);
  const url = isLlamaServer ? `${baseUrl}/v1/chat/completions` : `${baseUrl}/api/chat`;
  const body = isLlamaServer
    ? JSON.stringify({ model, messages: chatMessages, max_tokens: maxTokens || 256, temperature: 0.7 })
    : JSON.stringify({
        model,
        messages: chatMessages,
        stream: false,
        keep_alive: OLLAMA_KEEP_ALIVE,
        options: {
          num_ctx: OLLAMA_NUM_CTX,
          num_predict: maxTokens || 256,
          num_thread: OLLAMA_NUM_THREAD,
          temperature: 0.7,
        },
      });

  // Run under the global limiter so concurrent callers queue instead of all
  // hammering the CPU-bound local model at once.
  return localInference.run(async () => {
    // NOTE: llama-server returns 503 while loading a model. Retry up to 3 times
    // with exponential backoff to avoid falling back to paid API unnecessarily.
    const MAX_RETRIES = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(60000),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          // OpenAI-compatible (llama-server)
          choices?: Array<{ message?: { content: string } }>;
          usage?: { total_tokens?: number };
          // Ollama native (/api/chat)
          message?: { content?: string };
          eval_count?: number;
          prompt_eval_count?: number;
        };

        const content = isLlamaServer
          ? data.choices?.[0]?.message?.content
          : data.message?.content;
        if (!content) {
          throw new Error('Local LLM returned empty response');
        }

        const tokensUsed = isLlamaServer
          ? data.usage?.total_tokens || 0
          : (data.eval_count || 0) + (data.prompt_eval_count || 0);

        return { content, tokensUsed };
      }

      // Retry on 503 (model loading) — don't fall back to paid API yet
      if (response.status === 503 && attempt < MAX_RETRIES) {
        const waitMs = 2000 * (attempt + 1);
        log.info({ attempt: attempt + 1, waitMs }, 'Local LLM loading model, retrying...');
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      const errorText = await response.text();
      lastError = new Error(`Local LLM API error (${response.status}): ${errorText}`);
    }

    throw lastError ?? new Error('Local LLM failed after retries');
  });
}

/**
 * OpenAI-compatible API call (streaming).
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
