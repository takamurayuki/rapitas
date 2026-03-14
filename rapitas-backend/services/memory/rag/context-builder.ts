/**
 * RAG Context Builder
 *
 * Builds RAG context strings from queries for injection into agent prompts.
 */
import { createLogger } from '../../../config/logger';
import { searchKnowledge } from './search';
import type { RAGContext } from '../types';

const log = createLogger('memory:rag:context-builder');

/**
 * Build RAG context from a query string.
 */
export async function buildRAGContext(
  query: string,
  options?: {
    limit?: number;
    minSimilarity?: number;
    themeId?: number;
  },
): Promise<RAGContext> {
  const { limit = 5, minSimilarity = 0.6, themeId } = options ?? {};

  try {
    const results = await searchKnowledge({
      query,
      limit,
      minSimilarity,
      forgettingStage: 'active',
      themeId,
    });

    const entries = results.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      category: r.category,
      confidence: r.confidence,
      similarity: r.similarity,
    }));

    // Build context text string
    let contextText = '';
    if (entries.length > 0) {
      contextText = [
        '## 関連する知識ベース',
        '',
        ...entries
          .map(
            (e, i) =>
              `### ${i + 1}. ${e.title} (信頼度: ${(e.confidence * 100).toFixed(0)}%, 類似度: ${(e.similarity * 100).toFixed(0)}%)`,
          )
          .map((header, i) => `${header}\n${entries[i].content}\n`),
      ].join('\n');
    }

    return { query, entries, contextText };
  } catch (error) {
    log.warn({ err: error, query }, 'Failed to build RAG context, returning empty');
    return { query, entries: [], contextText: '' };
  }
}

/**
 * Build RAG context for task execution.
 *
 * Searches related knowledge using the task's title, description, and theme.
 */
export async function buildTaskRAGContext(task: {
  title: string;
  description?: string | null;
  themeId?: number | null;
}): Promise<string> {
  const query = [task.title, task.description].filter(Boolean).join(' ');

  const context = await buildRAGContext(query, {
    limit: 5,
    minSimilarity: 0.5,
    themeId: task.themeId ?? undefined,
  });

  return context.contextText;
}
