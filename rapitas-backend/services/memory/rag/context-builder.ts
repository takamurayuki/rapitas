/**
 * RAGコンテキストビルダー
 * クエリからRAGコンテキスト文字列を構築し、エージェントプロンプトに注入
 */
import { createLogger } from '../../../config/logger';
import { searchKnowledge } from './search';
import type { RAGContext } from '../types';

const log = createLogger('memory:rag:context-builder');

/**
 * クエリからRAGコンテキストを構築
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

    // コンテキスト文字列を構築
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
 * タスク実行用のRAGコンテキストを構築
 * タスクのタイトル、説明、テーマから関連知識を検索
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
