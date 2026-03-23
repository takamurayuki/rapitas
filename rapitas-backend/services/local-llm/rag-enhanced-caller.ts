/**
 * RAG-Enhanced Local LLM Caller
 *
 * Wraps sendAIMessage to automatically inject RAG context into local LLM prompts.
 * Retrieves relevant knowledge from the vector store and prepends it to the system prompt,
 * giving the small local model access to domain-specific context it wouldn't otherwise have.
 */
import { sendAIMessage, type AIRequestOptions, type AIResponse } from '../../utils/ai-client';
import { buildRAGContext } from '../memory/rag/context-builder';
import { createLogger } from '../../config';

const log = createLogger('local-llm:rag-enhanced');

/** Options controlling RAG injection behavior. */
export interface RAGEnhancedOptions extends AIRequestOptions {
  /** Enable/disable RAG injection. Defaults to true for ollama provider. */
  enableRAG?: boolean;
  /** Maximum number of knowledge entries to inject. */
  ragLimit?: number;
  /** Minimum similarity threshold for RAG results. */
  ragMinSimilarity?: number;
  /** Theme ID to scope RAG search. */
  ragThemeId?: number;
  /** Custom query for RAG search. If omitted, extracted from the last user message. */
  ragQuery?: string;
}

/**
 * Extract a search query from the user messages in a conversation.
 *
 * Uses the last user message content, truncated to 500 chars to avoid
 * excessively long embedding inputs.
 *
 * @param messages - Conversation messages. / 会話メッセージ
 * @returns Extracted query string. / 抽出されたクエリ文字列
 */
function extractQueryFromMessages(messages: AIRequestOptions['messages']): string {
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) return '';
  return lastUserMessage.content.slice(0, 500);
}

/**
 * Send a message to the local LLM with automatic RAG context injection.
 *
 * Retrieves relevant knowledge entries from the vector store and prepends
 * them to the system prompt, augmenting the small model's knowledge.
 *
 * @param options - Request options with optional RAG configuration. / RAG設定付きリクエストオプション
 * @returns AI response with optional RAG metadata. / RAGメタデータ付きAIレスポンス
 */
export async function sendRAGEnhancedMessage(
  options: RAGEnhancedOptions,
): Promise<AIResponse & { ragEntriesUsed: number }> {
  const {
    enableRAG = true,
    ragLimit = 3,
    ragMinSimilarity = 0.5,
    ragThemeId,
    ragQuery,
    ...aiOptions
  } = options;

  let ragEntriesUsed = 0;
  let enhancedSystemPrompt = aiOptions.systemPrompt || '';

  if (enableRAG) {
    try {
      const query = ragQuery || extractQueryFromMessages(aiOptions.messages);

      if (query.length > 0) {
        const ragContext = await buildRAGContext(query, {
          limit: ragLimit,
          minSimilarity: ragMinSimilarity,
          themeId: ragThemeId,
        });

        ragEntriesUsed = ragContext.entries.length;

        if (ragContext.contextText.length > 0) {
          enhancedSystemPrompt = ragContext.contextText + '\n\n---\n\n' + enhancedSystemPrompt;
          log.debug(
            { ragEntries: ragEntriesUsed, queryLength: query.length },
            'RAG context injected into local LLM prompt',
          );
        }
      }
    } catch (error) {
      // NOTE: RAG failure should not block the LLM call — degrade gracefully.
      log.warn({ err: error }, 'RAG context injection failed, proceeding without context');
    }
  }

  const response = await sendAIMessage({
    ...aiOptions,
    systemPrompt: enhancedSystemPrompt,
  });

  return { ...response, ragEntriesUsed };
}
