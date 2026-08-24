/**
 * RAG Context Builder
 *
 * Builds RAG context strings from queries for injection into agent prompts
 * (the single-execution / task-executor path). Uses the same hybrid recall
 * entry point and RAPITAS_KB_RECALL_* configuration as the workflow path so
 * both agree on stages and thresholds.
 */
import { createLogger } from '../../../config/logger';
import { searchKnowledgeHybrid } from '../recall/hybrid-search';
import { getRecallConfig } from '../recall/recall-config';
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
  const cfg = getRecallConfig();
  const { limit = 5, minSimilarity = cfg.minSimilarity, themeId } = options ?? {};

  try {
    const results = await searchKnowledgeHybrid({
      query,
      limit,
      minSimilarity,
      stages: cfg.stages,
      stageWeights: cfg.stageWeights,
      themeId,
      telemetry: { source: 'task_rag' },
    });

    const entries = results.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      category: r.category,
      confidence: r.confidence,
      // Lexical-only hits carry no cosine; surface their coverage as the score.
      similarity: r.channel === 'lexical' ? (r.lexicalScore ?? 0) : r.similarity,
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
 * The similarity floor comes from the recall config (no per-caller constant).
 */
export async function buildTaskRAGContext(task: {
  title: string;
  description?: string | null;
  themeId?: number | null;
}): Promise<string> {
  const query = [task.title, task.description].filter(Boolean).join(' ');

  const context = await buildRAGContext(query, {
    limit: 5,
    themeId: task.themeId ?? undefined,
  });

  return context.contextText;
}
