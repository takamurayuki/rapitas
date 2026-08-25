/**
 * Workflow Memory Context
 *
 * Retrieves relevant past knowledge for a task (similar lessons, prior concerns,
 * task patterns) from the knowledge base via the hybrid recall entry point
 * (vector + lexical, all forgetting stages, config-driven thresholds) and
 * renders it as a prompt section injected into the researcher / planner /
 * implementer / verifier context. This closes the "the agent never learns from
 * itself" gap: every run starts from a blank slate unless prior findings are
 * fed back in.
 *
 * Recall is OUTCOME-WEIGHTED: an entry learned from a task that succeeded
 * first-try is ranked above one whose source task was blocked, and blocked
 * entries are explicitly labelled as failure lessons (negative examples) rather
 * than dropped — "we tried X and it broke Y" is exactly what must not repeat.
 *
 * NOT responsible for executing agents, writing files, or generating embeddings —
 * it only reads the knowledge base and formats (rendering lives in
 * workflow-memory-render.ts). Every failure path (embeddings disabled, no DB,
 * empty result) degrades silently to an empty string so context building never
 * breaks because memory was unavailable.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { searchKnowledgeHybrid } from '../memory/recall/hybrid-search';
import { getRecallConfig } from '../memory/recall/recall-config';
import { recordRetrieval } from '../memory/outcome-reinforcement';
import { applyOutcomeWeighting, renderMemorySection } from './workflow-memory-render';
import type { EntryOutcome, MemoryEntry } from './workflow-memory-render';

// Re-exported so existing importers (tests, other contexts) keep one entry point.
export { applyOutcomeWeighting, renderMemorySection, TEXT } from './workflow-memory-render';
export type { EntryOutcome, MemoryEntry } from './workflow-memory-render';

const log = createLogger('workflow:memory-context');

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

    // One hybrid call: prefers project-scoped knowledge and falls back to
    // cross-project lessons (themeFallback) so a brand-new project still
    // benefits from globally-learned patterns. Stages / threshold / count come
    // from RAPITAS_KB_RECALL_* so nothing is hard-coded here any more.
    const cfg = getRecallConfig();
    const results = await searchKnowledgeHybrid({
      query,
      limit: cfg.maxEntries,
      minSimilarity: cfg.minSimilarity,
      stages: cfg.stages,
      stageWeights: cfg.stageWeights,
      themeId,
      themeFallback: true,
      telemetry: { source: 'workflow', taskId },
    });

    // Record which entries were injected into THIS task so outcome-reinforcement
    // can reward them on success / decay them on failure (outcome-gated learning).
    recordRetrieval(
      taskId,
      results.map((r) => r.id),
    );

    // Ledger the recall itself, INCLUDING when it found nothing — an empty
    // recall is the common case and is invisible to reinforcement, which only
    // ever sees entries that were actually injected.
    void import('../decision-ledger')
      .then(({ recordRecallDecision }) =>
        recordRecallDecision({
          taskId,
          entryIds: results.map((r) => r.id),
          minSimilarity: cfg.minSimilarity,
        }),
      )
      .catch(() => {});

    const entries: MemoryEntry[] = results.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      category: r.category,
      similarity: r.similarity,
      sourceTaskId: r.taskId,
      validationStatus: r.validationStatus,
      forgettingStage: r.forgettingStage,
      channel: r.channel,
      lexicalScore: r.lexicalScore,
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
