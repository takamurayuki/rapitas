/**
 * Claude (Anthropic) API Provider
 */
import { createLogger } from '../../config/logger';
import { type AIMessage, type AIResponse } from './types';
import { formatApiError } from './error-handler';

const log = createLogger('ai-client:claude');

/**
 * Call Claude API (non-streaming).
 */
export async function callClaude(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<AIResponse> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });

  // Separate system role messages
  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  const systemContent =
    systemPrompt || messages.find((m) => m.role === 'system')?.content || undefined;

  // Retry logic for 529 Overloaded / 429 Rate Limit
  const MAX_RETRIES = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        ...(systemContent ? { system: systemContent } : {}),
        messages: chatMessages,
      });

      const textBlock = response.content.find((c: { type: string }) => c.type === 'text');
      const content = textBlock && textBlock.type === 'text' ? textBlock.text : '';
      const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

      return { content, tokensUsed };
    } catch (error: unknown) {
      lastError = error;
      const status = (error as { status?: number }).status;
      const isRetryable =
        status === 429 || status === 529 || (status !== undefined && status >= 500);
      if (!isRetryable || attempt === MAX_RETRIES) {
        throw error;
      }
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      log.warn(
        `Claude API error (status ${status}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Claude API streaming call.
 */
export async function callClaudeStream(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<ReadableStream> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });

  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  const systemContent =
    systemPrompt || messages.find((m) => m.role === 'system')?.content || undefined;

  return new ReadableStream({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model,
          max_tokens: maxTokens,
          ...(systemContent ? { system: systemContent } : {}),
          messages: chatMessages,
        });

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const data = JSON.stringify({ content: event.delta.text });
            controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          }
        }
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error: unknown) {
        const errorData = JSON.stringify({
          error: formatApiError(error, 'claude'),
        });
        controller.enqueue(new TextEncoder().encode(`data: ${errorData}\n\n`));
        controller.close();
      }
    },
  });
}
