/**
 * Idea Extractor, Enricher & Reviewer
 *
 * Pipeline: Extract → Enrich (Ollama) → Review (different LLM)
 * - Extract: Pull actionable ideas from execution logs / copilot chat
 * - Enrich: Score actionability, specificity, impact (Ollama, free)
 * - Review: Second opinion from a different LLM — feasibility check,
 *           benefit analysis, idea refinement (Haiku)
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { getLocalLLMStatus } from '../local-llm';
import { getBestLocalModel } from '../local-llm/local-model-selector';
import { sendAIMessage } from '../../utils/ai-client';
import { submitIdea, resolveTaskThemeId } from './idea-box-service';
import { submitConcern, type ConcernType } from './concern-backlog-service';

const log = createLogger('memory:idea-extractor');

/**
 * Enrichment categories that are really *concerns* (bugs/refactors/perf), not
 * value-uplift ideas. Items the enricher tags with these are re-filed into the
 * Concern Backlog instead of cluttering the Idea Box.
 */
const CONCERN_CATEGORY_MAP: Record<string, ConcernType> = {
  bug_noticed: 'bug',
  security: 'security',
  tech_debt: 'refactor',
  performance: 'perf',
};

const MIN_CHAT_LENGTH = 5;

const EXTRACTION_PROMPT = `あなたはソフトウェア開発の「改善アイデア」抽出AIです。
以下のコンテンツから、プロダクトを**より良くする前向きなアイデアだけ**を抽出してください（今は壊れていないが、あれば価値・品質・生産性・UXが上がるもの）。

抽出対象（前向きな改善・革新のみ・厳格に判定）:
1. 新機能、または既存機能のブラッシュアップ
2. UX・使い勝手の具体的な改善案
3. 保守性・生産性を上げるしくみ（自動化・基盤改善・最適化など）
4. 革新的なアイデア

除外対象（必ず除外）:
- **バグ・不具合・エラー・クラッシュ・脆弱性・セキュリティ上の問題・「将来バグの温床になりそう」な箇所**（これらは「懸念」であり、アイデアではない。ここでは絶対に抽出しない）
- 「あると便利」レベルの曖昧な提案
- 既に完了した作業の繰り返し・サマリー、ステータス報告、完了報告
- 「検討する」「調査する」系の非実行型
- 実行ログのエコー、「テストが通った」「コミットした」などの作業報告
- 一般論・ベストプラクティスの羅列
- タスクのタイトルや説明文の言い換え

JSON配列で返してください（他のテキスト不要、最大3件）:
[{"title":"短い具体的タイトル","content":"何を・なぜ・期待される効果"}]

該当なしは [] を返してください。アイデアが質を満たさない、または「懸念」寄りの内容しかない場合は、無理に出さず [] にしてください。`;

const ENRICHMENT_PROMPT = `以下のアイデアを評価してください。

タイトル: {title}
内容: {content}

JSON形式で返してください（他のテキスト不要）:
{
  "actionability": 0.0〜1.0（すぐ実行に移せるか）,
  "specificity": 0.0〜1.0（具体的か）,
  "impact": "low" | "medium" | "high",
  "suggestedCategory": "improvement" | "bug_noticed" | "tech_debt" | "ux" | "feature" | "performance"
}`;

const REVIEW_PROMPT = `あなたはシニアソフトウェアエンジニアのレビュアーです。
以下のアイデアを別の視点からレビューしてください。

## アイデア
タイトル: {title}
内容: {content}

## レビュー観点
1. 妥当性: 現実の実装と著しい乖離がないか（実現可能か、技術的に正しいか）
2. 効果: この改善で得られる具体的な恩恵（パフォーマンス向上、UX改善、保守性向上など）
3. リスク: 実装に伴う潜在的なリスクや注意点
4. 強化提案: アイデアをより良くする具体的な提案（あれば）

JSON形式で返してください（他のテキスト不要）:
{
  "feasible": true/false（実現可能か）,
  "benefits": ["具体的な恩恵1", "恩恵2"],
  "risks": ["リスク1"],
  "refinedTitle": "より良いタイトル（変更不要ならnull）",
  "refinedContent": "より具体的で実行可能な説明（変更不要ならnull）",
  "reviewNote": "レビューの一言コメント"
}`;

/**
 * Extract ideas from agent execution results (verify.md + logs).
 */
export async function extractIdeasFromExecutionLog(
  taskId: number,
  verifyContent: string,
  executionLogs?: string,
): Promise<number[]> {
  if (!verifyContent && !executionLogs) return [];

  const context = [
    verifyContent ? `## 検証結果\n${verifyContent.slice(0, 2000)}` : '',
    executionLogs ? `## 実行ログ（抜粋）\n${executionLogs.slice(-1000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const themeId = await getTaskThemeId(taskId);
    const ideas = await callLLMForIdeas(context);
    const ids: number[] = [];

    for (const idea of ideas) {
      const id = await submitIdea({
        title: idea.title,
        content: idea.content,
        taskId,
        themeId: themeId ?? undefined,
        scope: themeId ? 'project' : 'global',
        source: 'agent_execution',
        confidence: 0.7,
      });
      ids.push(id);
      // Pipeline: enrich then review (both fire-and-forget)
      runEnrichAndReview(id, idea.title, idea.content);
    }

    log.info({ taskId, themeId, count: ids.length }, 'Ideas extracted from execution');
    return ids;
  } catch (err) {
    log.warn({ err, taskId }, 'Idea extraction from execution failed');
    return [];
  }
}

/**
 * Extract ideas from a copilot chat conversation.
 */
export async function extractIdeasFromCopilotChat(
  history: Array<{ role: string; content: string }>,
  taskId?: number,
): Promise<number[]> {
  if (history.length < MIN_CHAT_LENGTH) return [];

  const recent = history.slice(-10);
  const context = recent
    .map((m) => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content.slice(0, 300)}`)
    .join('\n');

  try {
    const themeId = taskId ? await getTaskThemeId(taskId) : null;
    const ideas = await callLLMForIdeas(`## コパイロットの会話\n${context}`);
    const ids: number[] = [];

    for (const idea of ideas) {
      const id = await submitIdea({
        title: idea.title,
        content: idea.content,
        taskId,
        themeId: themeId ?? undefined,
        scope: themeId ? 'project' : 'global',
        source: 'copilot',
        confidence: 0.5,
      });
      ids.push(id);
      runEnrichAndReview(id, idea.title, idea.content);
    }

    log.info({ taskId, themeId, count: ids.length }, 'Ideas extracted from copilot chat');
    return ids;
  } catch (err) {
    log.warn({ err, taskId }, 'Idea extraction from copilot failed');
    return [];
  }
}

/**
 * Resolve a task's theme for filed ideas, falling back to the working-directory
 * theme and then the default theme so ideas aren't dropped into "global".
 */
async function getTaskThemeId(taskId: number): Promise<number | null> {
  return resolveTaskThemeId(taskId);
}

/**
 * Minimum quality thresholds. Ideas below either bar after enrichment, or
 * flagged infeasible by the reviewer, are deleted from the IdeaBox.
 */
const MIN_ACTIONABILITY = 0.4;
const MIN_SPECIFICITY = 0.4;

// Serial enrichment queue. A burst of new ideas (e.g. a scheduled innovation
// session submitting several at once) otherwise fires many concurrent local-LLM
// enrichment calls, spiking CPU and starving foreground requests. Chaining the
// pipeline keeps it to one enrich/review at a time, spreading the load.
let enrichChain: Promise<unknown> = Promise.resolve();

/**
 * Runs the enrich → review pipeline for an idea, serialised through a global
 * queue. Fire-and-forget (never throws to the caller).
 *
 * @param id - Idea (knowledge entry) id / アイデアID
 * @param title - Idea title / タイトル
 * @param content - Idea content / 本文
 */
export function runEnrichAndReview(id: number, title: string, content: string): void {
  const runId = crypto.randomUUID();
  const startTime = Date.now();
  let llmCallCount = 0;

  log.info({ runId, ideaId: id }, 'enrichChain: start');

  enrichChain = enrichChain
    .then(async () => {
      const result = await enrichIdea(id, title, content, { runId });
      llmCallCount++;
      return result;
    })
    .then(async (enriched) => {
      if (enriched.kept) {
        await reviewIdea(id, runId);
        llmCallCount++;
      }
    })
    .then(() => {
      log.info(
        { runId, ideaId: id, durationMs: Date.now() - startTime, llmCallCount, outcome: 'success' },
        'enrichChain: complete',
      );
    })
    .catch((err) => {
      // NOTE: Errors here indicate a bug in enrichIdea/reviewIdea not catching internally.
      log.warn(
        { err, runId, ideaId: id, durationMs: Date.now() - startTime, llmCallCount },
        'enrichChain: error',
      );
    });
}

/**
 * One-time backfill: re-runs enrichment over every existing Idea Box entry so
 * that (a) concern-type items (bugs/refactors/perf) move to the Concern Backlog
 * and (b) priorities are re-derived from the latest scoring. Existing curated
 * ideas are preserved (the low-quality cull is disabled) and user-authored
 * entries are never reclassified and keep their priority. Work is serialised
 * through the shared enrichment queue and runs in the background.
 *
 * @returns Number of ideas queued for reprocessing. / 再処理キューに積んだ件数
 */
export async function reclassifyExistingIdeas(): Promise<number> {
  const ideas = await prisma.knowledgeEntry.findMany({
    where: { sourceType: 'idea_box', forgettingStage: 'active' },
    select: { id: true, title: true, content: true },
  });
  log.info({ count: ideas.length }, 'Idea reclassification backfill queued');
  for (const idea of ideas) {
    const loopIdeaId = idea.id;
    enrichChain = enrichChain
      .then(() => enrichIdea(loopIdeaId, idea.title, idea.content, { rejectLowQuality: false }))
      .catch((err) => {
        log.warn({ err, ideaId: loopIdeaId }, 'reclassifyExistingIdeas: enrichment error');
      });
  }
  return ideas.length;
}

/** Hard-delete an idea that failed quality checks. */
async function rejectIdea(ideaId: number, reason: string): Promise<void> {
  try {
    await prisma.knowledgeEntry.delete({ where: { id: ideaId } });
    log.info({ ideaId, reason }, 'Idea rejected and removed');
  } catch (err) {
    log.warn({ err, ideaId }, 'Failed to delete rejected idea');
  }
}

/**
 * Step 1: Enrich — score actionability, specificity, impact via Ollama (free).
 *
 * @param ideaId - ID of the idea to enrich / アイデアID
 * @param title - Idea title / タイトル
 * @param content - Idea content / 本文
 * @param options - Optional flags / オプション
 * @returns kept=false when the idea was deleted for failing quality bars.
 */
export async function enrichIdea(
  ideaId: number,
  title: string,
  content: string,
  options: { rejectLowQuality?: boolean; runId?: string } = {},
): Promise<{ kept: boolean }> {
  const { rejectLowQuality = true, runId } = options;
  const startTime = Date.now();
  try {
    const prompt = ENRICHMENT_PROMPT.replace('{title}', title).replace('{content}', content);
    const response = await callLLM(prompt, 200, 'local');

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { kept: true };

    const e = JSON.parse(jsonMatch[0]) as {
      actionability?: number;
      specificity?: number;
      impact?: string;
      suggestedCategory?: string;
    };

    const actionability = clamp(e.actionability ?? 0.5);
    const specificity = clamp(e.specificity ?? 0.5);
    const confidence = actionability * 0.6 + specificity * 0.4;

    // Single read of the entry's metadata, reused for concern-routing and the
    // user-priority guard below.
    const meta = await prisma.knowledgeEntry.findUnique({
      where: { id: ideaId },
      select: { sourceId: true, taskId: true, themeId: true, tags: true },
    });
    const isUserAuthored = meta?.sourceId === 'user';

    // Route concern-type material (bugs, refactors, perf) to the Concern Backlog
    // instead of the Idea Box — the extractor surfaces both kinds but they
    // belong in different inboxes. Skipped for user-authored entries (respect
    // the user's own filing). Done BEFORE the idea quality bar so a genuine bug
    // is never dropped just for being a poor "idea"; the idea entry is removed
    // once the concern is filed.
    const concernType = CONCERN_CATEGORY_MAP[e.suggestedCategory ?? ''];
    if (concernType && !isUserAuthored) {
      await submitConcern({
        title,
        detail: content,
        type: concernType,
        severity: deriveIdeaPriority(e.impact, actionability, specificity),
        originTaskId: meta?.taskId ?? undefined,
        themeId: meta?.themeId ?? undefined,
        source: 'idea_reclassified',
      });
      await rejectIdea(ideaId, `reclassified-to-concern type=${concernType}`);
      return { kept: false };
    }

    // Hard-reject ideas that fall below the quality bar. Skipped during a
    // backfill (rejectLowQuality=false) so existing curated ideas aren't culled,
    // AND for explicitly-filed ideas (sourceId='user' — manual or agent via POST
    // /idea-box): a deliberately-filed idea must stay visible even on a low score.
    // Only noisy machine-extracted ideas (source != 'user') are culled here.
    if (
      rejectLowQuality &&
      !isUserAuthored &&
      (actionability < MIN_ACTIONABILITY || specificity < MIN_SPECIFICITY)
    ) {
      await rejectIdea(
        ideaId,
        `enrich-below-threshold actionability=${actionability.toFixed(2)} specificity=${specificity.toFixed(2)}`,
      );
      return { kept: false };
    }

    // Map the enrichment signal to the idea's priority ("temperature") from
    // impact + actionability + specificity so the temperature actually varies.
    const derivedPriority = deriveIdeaPriority(e.impact, actionability, specificity);

    // Respect a user's explicitly chosen priority — only auto-derive for
    // machine-extracted ideas (source !== 'user').
    const existingTags = JSON.parse(meta?.tags ?? '[]') as string[];
    const existingPriority = existingTags
      .find((t) => t.startsWith('priority:'))
      ?.slice('priority:'.length);
    const finalPriority = isUserAuthored && existingPriority ? existingPriority : derivedPriority;

    const tags = existingTags.filter(
      (t) =>
        !['actionability:', 'specificity:', 'impact:', 'priority:'].some((p) => t.startsWith(p)),
    );
    tags.push(
      `actionability:${actionability.toFixed(2)}`,
      `specificity:${specificity.toFixed(2)}`,
      `impact:${e.impact ?? 'medium'}`,
      `priority:${finalPriority}`,
    );

    await prisma.knowledgeEntry.update({
      where: { id: ideaId },
      data: {
        confidence,
        category: e.suggestedCategory ?? 'improvement',
        tags: JSON.stringify(tags),
        validationStatus: 'validated',
      },
    });

    log.info(
      {
        ideaId,
        actionability,
        specificity,
        confidence,
        durationMs: Date.now() - startTime,
        ...(runId && { runId }),
      },
      'Idea enriched',
    );
    return { kept: true };
  } catch (err) {
    log.warn(
      { err, ideaId, durationMs: Date.now() - startTime, ...(runId && { runId }) },
      'Idea enrichment failed',
    );
    return { kept: true };
  }
}

/**
 * Step 2: Review — second opinion from a DIFFERENT LLM (Haiku).
 * Checks feasibility, analyzes benefits/risks, and optionally refines the idea.
 * Uses Haiku even if Ollama is available to get a genuinely different perspective.
 *
 * @param ideaId - ID of the idea to review / アイデアID
 * @param runId - Correlation ID from the parent enrichChain run / 親実行ID
 */
export async function reviewIdea(ideaId: number, runId?: string): Promise<void> {
  const startTime = Date.now();
  try {
    const entry = await prisma.knowledgeEntry.findUnique({
      where: { id: ideaId },
      select: { title: true, content: true, tags: true, sourceId: true },
    });
    if (!entry) return;

    const prompt = REVIEW_PROMPT.replace('{title}', entry.title).replace(
      '{content}',
      entry.content,
    );

    // NOTE: Always use Haiku for review to ensure a different perspective from
    // the Ollama model used in enrichment.
    const response = await callLLM(prompt, 400, 'cloud');

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const review = JSON.parse(jsonMatch[0]) as {
      feasible?: boolean;
      benefits?: string[];
      risks?: string[];
      refinedTitle?: string | null;
      refinedContent?: string | null;
      reviewNote?: string;
    };

    // Hard-reject infeasible ideas — but NEVER an explicitly-filed one
    // (sourceId='user'; the Idea Box POST tags every submission, agent included,
    // as 'user'). Deleting a deliberately-filed idea behind the user's back is
    // the "ideas stopped appearing" regression. For those, keep the entry and let
    // the feasible:false tag below record the verdict; only cull auto-extracted
    // ideas (source != 'user') here.
    if (review.feasible === false && entry.sourceId !== 'user') {
      await rejectIdea(ideaId, `review-infeasible note=${(review.reviewNote ?? '').slice(0, 80)}`);
      return;
    }

    const tags = await getAndFilterTags(ideaId, ['review:', 'benefits:', 'risks:', 'feasible:']);
    tags.push(`feasible:${review.feasible ?? true}`);
    if (review.benefits?.length) tags.push(`benefits:${review.benefits.join('|')}`);
    if (review.risks?.length) tags.push(`risks:${review.risks.join('|')}`);
    if (review.reviewNote) tags.push(`review:${review.reviewNote.slice(0, 100)}`);

    const updateData: Record<string, unknown> = {
      tags: JSON.stringify(tags),
    };

    // Apply refined title/content if reviewer suggested improvements
    if (review.refinedTitle) updateData.title = review.refinedTitle;
    if (review.refinedContent) updateData.content = review.refinedContent;

    await prisma.knowledgeEntry.update({
      where: { id: ideaId },
      data: updateData,
    });

    log.info(
      {
        ideaId,
        feasible: review.feasible,
        refined: !!(review.refinedTitle || review.refinedContent),
        durationMs: Date.now() - startTime,
        ...(runId && { runId }),
      },
      'Idea reviewed',
    );
  } catch (err) {
    log.warn(
      { err, ideaId, durationMs: Date.now() - startTime, ...(runId && { runId }) },
      'Idea review failed (non-critical)',
    );
  }
}

// --- Helpers ---

interface RawIdea {
  title: string;
  content: string;
}

/** Call LLM for idea extraction. Ollama preferred, Haiku fallback. */
async function callLLMForIdeas(context: string): Promise<RawIdea[]> {
  const text = await callLLM(`${EXTRACTION_PROMPT}\n\n---\n${context}`, 600, 'local');
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  const parsed = JSON.parse(jsonMatch[0]) as RawIdea[];
  return parsed.filter((i) => i.title && i.content).slice(0, 3);
}

/** Unified LLM call. 'local' prefers Ollama, 'cloud' always uses Haiku. */
async function callLLM(
  prompt: string,
  maxTokens: number,
  preference: 'local' | 'cloud',
): Promise<string> {
  let useLocal = false;
  if (preference === 'local') {
    const status = await getLocalLLMStatus().catch(() => ({ available: false }));
    useLocal = (status as { available: boolean }).available;
  }

  const response = await sendAIMessage({
    provider: useLocal ? 'ollama' : 'claude',
    model: useLocal ? await getBestLocalModel() : 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: prompt }],
    maxTokens,
  });
  return response.content;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Derive an idea's priority ("temperature") from the enrichment signal as a
 * weighted score, so the result spreads across all four levels instead of
 * collapsing to `medium` whenever the model returns a middling `impact`.
 * `impact` dominates; actionability and specificity nudge it up.
 *
 * @param impact - Enrichment impact estimate (low | medium | high). / 影響度
 * @param actionability - 0..1 how readily it can be acted on. / 着手しやすさ
 * @param specificity - 0..1 how concrete/specific it is. / 具体性
 * @returns A valid priority/severity string. / 優先度（懸念の重大度にも流用）
 */
function deriveIdeaPriority(
  impact: string | undefined,
  actionability: number,
  specificity: number,
): 'urgent' | 'high' | 'medium' | 'low' {
  const impactWeight =
    (impact ?? 'medium').toLowerCase() === 'high'
      ? 0.7
      : (impact ?? 'medium').toLowerCase() === 'low'
        ? 0.1
        : 0.4;
  const score = impactWeight + actionability * 0.25 + specificity * 0.15;
  if (score >= 0.85) return 'urgent';
  if (score >= 0.6) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

/** Get existing tags and filter out prefixes that will be replaced. */
async function getAndFilterTags(ideaId: number, prefixes: string[]): Promise<string[]> {
  const existing = await prisma.knowledgeEntry.findUnique({
    where: { id: ideaId },
    select: { tags: true },
  });
  const current = JSON.parse(existing?.tags ?? '[]') as string[];
  return current.filter((t) => !prefixes.some((p) => t.startsWith(p)));
}
