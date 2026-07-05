/**
 * Workflow Memory Context
 *
 * Retrieves relevant past knowledge for a task (similar lessons, prior concerns,
 * task patterns) from the RAG knowledge base and renders it as a prompt section
 * injected into the researcher / planner / implementer context. This closes the
 * "the agent never learns from itself" gap: every run starts from a blank slate
 * unless prior findings are fed back in.
 *
 * Recall is OUTCOME-WEIGHTED: an entry learned from a task that succeeded
 * first-try is ranked above one whose source task was blocked, and blocked
 * entries are explicitly labelled as failure lessons (negative examples) rather
 * than dropped — "we tried X and it broke Y" is exactly what must not repeat.
 *
 * NOT responsible for executing agents, writing files, or generating embeddings —
 * it only reads the knowledge base and formats. Every failure path (embeddings
 * disabled, no DB, empty result) degrades silently to an empty string so context
 * building never breaks because memory was unavailable.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { searchKnowledge } from '../memory/rag/search';
import { recordRetrieval } from '../memory/outcome-reinforcement';

const log = createLogger('workflow:memory-context');

/** Max knowledge entries injected — bounds prompt growth. */
const MAX_ENTRIES = 6;
/** Minimum cosine similarity to be considered relevant. */
const MIN_SIMILARITY = 0.55;
/** Per-entry content snippet length fed to the model. */
const SNIPPET_LEN = 400;

/** The outcome of the task an entry was learned from. */
export type EntryOutcome = 'first_try' | 'completed' | 'blocked';

/** A knowledge entry shaped for rendering. */
export interface MemoryEntry {
  title: string;
  content: string;
  category: string;
  similarity: number;
  /** Source task the entry was learned from (null when unknown). */
  sourceTaskId?: number | null;
  /** Outcome of that source task — drives ranking weight and the label. */
  outcome?: EntryOutcome | null;
  /** KB validation state — labels contested (conflict) knowledge as uncertain. */
  validationStatus?: string;
}

/** Recall ranking weight by source-task outcome. */
const OUTCOME_MULTIPLIER: Record<EntryOutcome, number> = {
  first_try: 1.2,
  completed: 1.05,
  // Kept (a failure is a lesson) but ranked lower so proven knowledge leads.
  blocked: 0.7,
};

const TEXT = {
  ja: {
    header: '# 過去の知見（記憶からの参照 — 同じ轍を踏まないこと）',
    lead: '以下は過去のタスク・懸念・教訓から、本タスクに関連性が高い順に抽出した知見です。調査・実装の前提として活用し、既知の失敗や設計判断を繰り返さないでください。',
    relevance: '関連度',
    outcome: {
      first_try: '✅ 初回成功の知見',
      completed: '☑ 完了タスクの知見',
      blocked: '⚠️ 前回ブロック（失敗の教訓 — 同じ轍を避ける）',
    } as Record<EntryOutcome, string>,
  },
  en: {
    header: '# Prior Knowledge (recalled from memory — do not repeat past mistakes)',
    lead: 'The following are the most relevant lessons, concerns, and task patterns from past work. Use them as context for research/implementation and avoid repeating known failures or re-deciding settled design points.',
    relevance: 'relevance',
    outcome: {
      first_try: '✅ from a first-try success',
      completed: '☑ from a completed task',
      blocked: '⚠️ previously BLOCKED (failure lesson — avoid repeating)',
    } as Record<EntryOutcome, string>,
  },
} as const;

/**
 * Apply outcome weighting: attach each entry's outcome and re-sort by the
 * outcome-adjusted score. Pure — the testable core of the ranking change.
 *
 * @param entries - Entries with raw similarity + sourceTaskId. / 類似度付きエントリ
 * @param outcomeByTaskId - Map of source taskId → outcome. / タスク別アウトカム
 * @returns Entries with `outcome` set, sorted by adjusted score. / 重み付け後の並び
 */
export function applyOutcomeWeighting(
  entries: MemoryEntry[],
  outcomeByTaskId: Map<number, EntryOutcome>,
): MemoryEntry[] {
  return (
    entries
      .map((e) => {
        const outcome =
          e.sourceTaskId != null ? (outcomeByTaskId.get(e.sourceTaskId) ?? null) : null;
        return {
          entry: { ...e, outcome },
          score: e.similarity * (outcome ? OUTCOME_MULTIPLIER[outcome] : 1),
        };
      })
      // Tie-break on title then content: MemoryEntry has no id, and two entries
      // can land on an identical outcome-adjusted score (e.g. equal similarity +
      // same outcome weight). Array#sort is not guaranteed stable across engines,
      // so pin the tie order to the entry text to keep the injected prompt slice
      // identical across repeated runs of the same query.
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.entry.title.localeCompare(b.entry.title) ||
          a.entry.content.localeCompare(b.entry.content),
      )
      .map((x) => x.entry)
  );
}

/**
 * Render retrieved entries as a markdown prompt section. Pure — the testable core.
 *
 * @param entries - Relevant knowledge entries (already ranked). / 関連知見（順位済み）
 * @param language - Output language. / 出力言語
 * @returns The markdown section, or '' when there is nothing to inject. / 注入する節（無ければ空文字）
 */
export function renderMemorySection(entries: MemoryEntry[], language: 'ja' | 'en'): string {
  if (entries.length === 0) return '';
  const t = TEXT[language];
  const items = entries
    .map((e) => {
      const pct = Math.round(e.similarity * 100);
      const outcomeMark = e.outcome ? ` — ${t.outcome[e.outcome]}` : '';
      // Flag contested knowledge so the agent weighs it critically instead of
      // treating a 1-of-a-contradicting-pair entry as settled fact.
      const conflictMark =
        e.validationStatus === 'conflict'
          ? language === 'ja'
            ? ' — ⚠️ 矛盾あり・要検証'
            : ' — ⚠️ contested, verify'
          : '';
      const marker = `${outcomeMark}${conflictMark}`;
      const snippet =
        e.content.length > SNIPPET_LEN ? `${e.content.slice(0, SNIPPET_LEN)}…` : e.content;
      return `## [${e.category}] ${e.title} (${t.relevance} ${pct}%)${marker}\n${snippet}`;
    })
    .join('\n\n');
  return `${t.header}\n\n${t.lead}\n\n${items}`;
}

/** Trailing window and cap for episodic failure recall. */
const EPISODE_WINDOW_DAYS = 14;
const MAX_EPISODES = 3;

/**
 * Render the freshest failure episodes (theme-scoped when possible) as a short
 * prompt section. Best-effort — any failure yields ''.
 *
 * @param themeId - Theme to scope to (null → all themes). / 対象テーマ
 * @param language - Output language. / 出力言語
 * @returns Markdown section, or '' when there are no recent failures. / 節
 */
async function buildFailureEpisodeSection(
  themeId: number | null,
  language: 'ja' | 'en',
): Promise<string> {
  try {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - EPISODE_WINDOW_DAYS);
    const rows = await prisma.episodeMemory.findMany({
      where: { outcome: 'failure', phase: 'evaluate', createdAt: { gte: cutoff } },
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
      // Over-fetch so theme filtering (context is a JSON string) still fills the cap.
      take: 20,
      select: { content: true, context: true, createdAt: true },
    });
    if (rows.length === 0) return '';

    const matchesTheme = (context: string): boolean => {
      if (themeId == null) return true;
      try {
        return (JSON.parse(context) as { themeId?: number | null }).themeId === themeId;
      } catch {
        return false;
      }
    };
    const themed = rows.filter((r) => matchesTheme(r.context));
    const picked = (themed.length > 0 ? themed : rows).slice(0, MAX_EPISODES);
    if (picked.length === 0) return '';

    const header =
      language === 'ja'
        ? '## 最近の失敗エピソード（直近の実行で実際に起きたこと）'
        : '## Recent failure episodes (what actually went wrong lately)';
    const items = picked
      .map((e) => `- ${e.createdAt.toISOString().slice(0, 10)}: ${e.content}`)
      .join('\n');
    return `${header}\n${items}`;
  } catch {
    return '';
  }
}

/**
 * Fetch the outcome of each source task from the timeline (`task_outcome`
 * events). Best-effort — a failure yields an empty map (no weighting applied).
 */
async function fetchOutcomes(taskIds: number[]): Promise<Map<number, EntryOutcome>> {
  const map = new Map<number, EntryOutcome>();
  if (taskIds.length === 0) return map;
  try {
    const events = await prisma.timelineEvent.findMany({
      where: {
        eventType: 'task_outcome',
        correlationId: { in: taskIds.map((id) => `task_${id}`) },
      },
      // id tiebreak: two task_outcome events can share a createdAt timestamp
      // (same millisecond); the "first = latest" dedup below relies on a
      // stable order, so break ties by id (higher id = written later).
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { correlationId: true, payload: true },
    });
    for (const ev of events) {
      const id = Number((ev.correlationId ?? '').replace('task_', ''));
      if (!Number.isFinite(id) || map.has(id)) continue; // desc order → first = latest
      let payload: { finalStatus?: string; firstTrySuccess?: boolean } = {};
      try {
        payload = JSON.parse(ev.payload) as typeof payload;
      } catch {
        continue;
      }
      if (payload.finalStatus === 'completed') {
        map.set(id, payload.firstTrySuccess ? 'first_try' : 'completed');
      } else if (payload.finalStatus === 'blocked') {
        map.set(id, 'blocked');
      }
    }
  } catch (err) {
    log.warn({ err }, '[memory-context] outcome fetch failed — skipping weighting');
  }
  return map;
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

    // Record which entries were injected into THIS task so outcome-reinforcement
    // can reward them on success / decay them on failure (outcome-gated learning).
    recordRetrieval(
      taskId,
      results.map((r) => r.id),
    );

    const entries: MemoryEntry[] = results.map((r) => ({
      title: r.title,
      content: r.content,
      category: r.category,
      similarity: r.similarity,
      sourceTaskId: r.taskId,
      validationStatus: r.validationStatus,
    }));

    // Outcome-weight: rank proven knowledge above failures, label failures.
    const sourceTaskIds = entries
      .map((e) => e.sourceTaskId)
      .filter((id): id is number => typeof id === 'number');
    const outcomes = await fetchOutcomes(sourceTaskIds);
    const ranked = applyOutcomeWeighting(entries, outcomes);

    let section = renderMemorySection(ranked, language);
    // Episodic recall: recent failure episodes for this theme. The episode
    // table was write-only for the loop (recorded per task outcome, read by
    // no prompt) — surfacing the freshest failures tells the agent what has
    // been going wrong RIGHT NOW in this area, complementing the distilled
    // knowledge entries above.
    const episodes = await buildFailureEpisodeSection(themeId ?? null, language);
    if (episodes) section = section ? `${section}\n\n${episodes}` : episodes;
    if (section) {
      log.info(
        { taskId, themeId, count: ranked.length, weighted: outcomes.size },
        '[memory-context] Injected prior knowledge (outcome-weighted)',
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
