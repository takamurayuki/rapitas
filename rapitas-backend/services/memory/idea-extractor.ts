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
import { sendAIMessage } from '../../utils/ai-client';
import { submitIdea } from './idea-box-service';

const log = createLogger('memory:idea-extractor');

const MIN_CHAT_LENGTH = 5;

const EXTRACTION_PROMPT = `あなたはソフトウェア開発のアイデア抽出AIです。
以下のコンテンツから、ユーザー体験またはコード品質に直接影響する改善アイデアのみを抽出してください。

抽出対象:
1. 実装中に気づいた設計上の問題
2. テストや検証で発見した未対処のエッジケース
3. パフォーマンスのボトルネック
4. ユーザー体験を損なう具体的な問題

除外対象:
- 「あると便利」レベルの曖昧な提案
- 既に完了した作業の繰り返し
- 「検討する」「調査する」系の非実行型

JSON配列で返してください（他のテキスト不要、最大3件）:
[{"title":"短い具体的タイトル","content":"何を・なぜ・どこで改善すべきかの説明"}]

該当なしは [] を返してください。`;

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
    const ideas = await callLLMForIdeas(context);
    const ids: number[] = [];

    for (const idea of ideas) {
      const id = await submitIdea({
        title: idea.title,
        content: idea.content,
        taskId,
        source: 'agent_execution',
        confidence: 0.7,
      });
      ids.push(id);
      // Pipeline: enrich then review (both fire-and-forget)
      runEnrichAndReview(id, idea.title, idea.content);
    }

    log.info({ taskId, count: ids.length }, 'Ideas extracted from execution');
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
    const ideas = await callLLMForIdeas(`## コパイロットの会話\n${context}`);
    const ids: number[] = [];

    for (const idea of ideas) {
      const id = await submitIdea({
        title: idea.title,
        content: idea.content,
        taskId,
        source: 'copilot',
        confidence: 0.5,
      });
      ids.push(id);
      runEnrichAndReview(id, idea.title, idea.content);
    }

    log.info({ taskId, count: ids.length }, 'Ideas extracted from copilot chat');
    return ids;
  } catch (err) {
    log.warn({ err, taskId }, 'Idea extraction from copilot failed');
    return [];
  }
}

/** Run the full enrich → review pipeline as fire-and-forget. */
function runEnrichAndReview(id: number, title: string, content: string): void {
  enrichIdea(id, title, content)
    .then(() => reviewIdea(id))
    .catch(() => {});
}

/**
 * Step 1: Enrich — score actionability, specificity, impact via Ollama (free).
 */
export async function enrichIdea(ideaId: number, title: string, content: string): Promise<void> {
  try {
    const prompt = ENRICHMENT_PROMPT.replace('{title}', title).replace('{content}', content);
    const response = await callLLM(prompt, 200, 'local');

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const e = JSON.parse(jsonMatch[0]) as {
      actionability?: number;
      specificity?: number;
      impact?: string;
      suggestedCategory?: string;
    };

    const actionability = clamp(e.actionability ?? 0.5);
    const specificity = clamp(e.specificity ?? 0.5);
    const confidence = actionability * 0.6 + specificity * 0.4;

    const tags = await getAndFilterTags(ideaId, ['actionability:', 'specificity:', 'impact:']);
    tags.push(
      `actionability:${actionability.toFixed(2)}`,
      `specificity:${specificity.toFixed(2)}`,
      `impact:${e.impact ?? 'medium'}`,
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

    log.debug({ ideaId, actionability, specificity, confidence }, 'Idea enriched');
  } catch (err) {
    log.warn({ err, ideaId }, 'Idea enrichment failed');
  }
}

/**
 * Step 2: Review — second opinion from a DIFFERENT LLM (Haiku).
 * Checks feasibility, analyzes benefits/risks, and optionally refines the idea.
 * Uses Haiku even if Ollama is available to get a genuinely different perspective.
 */
export async function reviewIdea(ideaId: number): Promise<void> {
  try {
    const entry = await prisma.knowledgeEntry.findUnique({
      where: { id: ideaId },
      select: { title: true, content: true, tags: true },
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

    // If not feasible, lower confidence significantly
    const confidenceAdjust = review.feasible === false ? 0.5 : 1.0;

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

    // Adjust confidence based on feasibility
    if (confidenceAdjust < 1.0) {
      const current = await prisma.knowledgeEntry.findUnique({
        where: { id: ideaId },
        select: { confidence: true },
      });
      updateData.confidence = (current?.confidence ?? 0.5) * confidenceAdjust;
    }

    await prisma.knowledgeEntry.update({
      where: { id: ideaId },
      data: updateData,
    });

    log.debug(
      {
        ideaId,
        feasible: review.feasible,
        refined: !!(review.refinedTitle || review.refinedContent),
      },
      'Idea reviewed',
    );
  } catch (err) {
    log.warn({ err, ideaId }, 'Idea review failed (non-critical)');
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
    model: useLocal ? 'llama3.2' : 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: prompt }],
    maxTokens,
  });
  return response.content;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
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
