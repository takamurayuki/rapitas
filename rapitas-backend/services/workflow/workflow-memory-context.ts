/**
 * Workflow Memory Context
 *
 * Retrieves relevant past knowledge for a task (similar lessons, prior concerns,
 * task patterns) from the RAG knowledge base and renders it as a prompt section
 * injected into the researcher / implementer context. This closes the "the agent
 * never learns from itself" gap: every run starts from a blank slate unless prior
 * findings are fed back in.
 *
 * NOT responsible for executing agents, writing files, or generating embeddings —
 * it only reads the knowledge base and formats. Every failure path (embeddings
 * disabled, no DB, empty result) degrades silently to an empty string so context
 * building never breaks because memory was unavailable.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { searchKnowledge } from '../memory/rag/search';

const log = createLogger('workflow:memory-context');

/** Max knowledge entries injected — bounds prompt growth. */
const MAX_ENTRIES = 6;
/** Minimum cosine similarity to be considered relevant. */
const MIN_SIMILARITY = 0.55;
/** Per-entry content snippet length fed to the model. */
const SNIPPET_LEN = 400;

/** A knowledge entry shaped for rendering. */
export interface MemoryEntry {
  title: string;
  content: string;
  category: string;
  similarity: number;
}

const TEXT = {
  ja: {
    header: '# 過去の知見（記憶からの参照 — 同じ轍を踏まないこと）',
    lead: '以下は過去のタスク・懸念・教訓から、本タスクに関連性が高い順に抽出した知見です。調査・実装の前提として活用し、既知の失敗や設計判断を繰り返さないでください。',
    relevance: '関連度',
  },
  en: {
    header: '# Prior Knowledge (recalled from memory — do not repeat past mistakes)',
    lead: 'The following are the most relevant lessons, concerns, and task patterns from past work. Use them as context for research/implementation and avoid repeating known failures or re-deciding settled design points.',
    relevance: 'relevance',
  },
} as const;

/**
 * Render retrieved entries as a markdown prompt section. Pure — the testable core.
 *
 * @param entries - Relevant knowledge entries (already sorted by similarity). / 関連知見（類似度降順）
 * @param language - Output language. / 出力言語
 * @returns The markdown section, or '' when there is nothing to inject. / 注入する節（無ければ空文字）
 */
export function renderMemorySection(entries: MemoryEntry[], language: 'ja' | 'en'): string {
  if (entries.length === 0) return '';
  const t = TEXT[language];
  const items = entries
    .map((e) => {
      const pct = Math.round(e.similarity * 100);
      const snippet =
        e.content.length > SNIPPET_LEN ? `${e.content.slice(0, SNIPPET_LEN)}…` : e.content;
      return `## [${e.category}] ${e.title} (${t.relevance} ${pct}%)\n${snippet}`;
    })
    .join('\n\n');
  return `${t.header}\n\n${t.lead}\n\n${items}`;
}

/**
 * Build the memory-context prompt section for a task. Always safe to call: any
 * failure (embeddings disabled, DB error, no matches) yields ''.
 *
 * @param taskId - Task being processed (used to resolve themeId). / 処理中タスクID
 * @param task - Task title and description (the recall query). / タスクのタイトルと説明
 * @param language - Output language. / 出力言語
 * @returns Markdown memory section, or '' when nothing relevant exists. / 記憶の節（無ければ空文字）
 */
export async function buildMemoryContext(
  taskId: number,
  task: { title: string; description: string | null },
  language: 'ja' | 'en' = 'ja',
): Promise<string> {
  try {
    const query = `${task.title}\n${task.description ?? ''}`.trim();
    if (!query) return '';

    const taskRow = await prisma.task
      .findUnique({ where: { id: taskId }, select: { themeId: true } })
      .catch(() => null);
    const themeId = taskRow?.themeId ?? undefined;

    // Prefer project-scoped knowledge; fall back to cross-project lessons so a
    // brand-new project still benefits from globally-learned patterns.
    let results = await searchKnowledge({
      query,
      limit: MAX_ENTRIES,
      minSimilarity: MIN_SIMILARITY,
      forgettingStage: 'active',
      themeId,
    });
    if (results.length === 0 && themeId !== undefined) {
      results = await searchKnowledge({
        query,
        limit: MAX_ENTRIES,
        minSimilarity: MIN_SIMILARITY,
        forgettingStage: 'active',
      });
    }

    const entries: MemoryEntry[] = results.map((r) => ({
      title: r.title,
      content: r.content,
      category: r.category,
      similarity: r.similarity,
    }));
    const section = renderMemorySection(entries, language);
    if (section) {
      log.info(
        { taskId, themeId, count: entries.length },
        '[memory-context] Injected prior knowledge',
      );
    }
    return section;
  } catch (err) {
    // Embeddings disabled (@xenova not installed), DB down, etc. — memory is a
    // best-effort enhancement, never a hard dependency of context building.
    log.warn({ err, taskId }, '[memory-context] Skipped (memory unavailable)');
    return '';
  }
}
