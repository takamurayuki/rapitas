/**
 * Critic Lessons
 *
 * The cross-task learning loop for the phase critic: aggregates the reasons
 * past artifacts (any task) failed the research/plan critic gate, distills
 * them into a generalized pre-writing checklist, and renders it for injection
 * into the producing role's context BEFORE generation. This moves recurring
 * findings from the post-hoc gate (bounce = expensive rework) to the prompt
 * (prevention = free), leaving the gate to catch NEW kinds of misses.
 * Same-task bounce feedback is NOT this module — see buildCriticFeedback.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { sendAIMessage, getDefaultProvider, isAnyApiKeyConfigured } from '../../../utils/ai-client';
import type { CriticPhase } from './phase-critic-types';

const log = createLogger('workflow:critic-lessons');

/** Latest N critic-failure transitions considered per phase. */
const SOURCE_WINDOW = 80;
/** Minimum source reasons before distilling — thin evidence overfits. */
const MIN_REASONS = 4;
/** Findings must recur across at least this many distinct tasks. */
const MIN_TASKS = 2;
/** Max checklist items injected — a nudge, not a wall. */
const MAX_LESSONS = 8;
/** Per-item length cap; longer items are distillation failures, dropped. */
const MAX_LESSON_CHARS = 160;
/** Re-distill at most this often even when no new failures arrive. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Cap on the reason text handed to the distiller. */
const MAX_SOURCE_CHARS = 7000;

interface CacheEntry {
  /** `${latest transition id}:${row count}` — new failures invalidate. */
  fingerprint: string;
  at: number;
  bullets: string[];
}

const cache = new Map<CriticPhase, CacheEntry>();

/**
 * Whether cross-task critic-lesson injection is enabled (default ON).
 * Set RAPITAS_CRITIC_LESSONS=0/false/off to opt out.
 */
export function isCriticLessonsEnabled(): boolean {
  const v = (process.env.RAPITAS_CRITIC_LESSONS || '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/**
 * Tolerantly parse the distiller's response into checklist bullets.
 * Invalid/oversized items are dropped rather than failing the whole set.
 *
 * @param content - Raw model response. / モデル応答の生文字列
 * @returns Validated bullets (possibly empty). / 検証済みチェック項目
 */
export function parseLessonsResponse(content: string): string[] {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x.length > 0 && x.length <= MAX_LESSON_CHARS)
      .slice(0, MAX_LESSONS);
  } catch {
    return [];
  }
}

/**
 * Render the checklist section, or '' with no bullets.
 *
 * @param bullets - Distilled lesson items. / 蒸留済み観点
 * @param phase - Which artifact the checklist targets. / 対象フェーズ
 * @param language - Output language for the framing text. / 出力言語
 * @returns Markdown section, or ''. / セクション文字列
 */
export function renderLessonsSection(
  bullets: string[],
  phase: CriticPhase,
  language: 'ja' | 'en' = 'ja',
): string {
  if (bullets.length === 0) return '';
  const artifact = phase === 'research' ? 'research.md' : 'plan.md';
  const header =
    language === 'ja'
      ? `## 過去タスクで頻出した見落とし観点（${artifact} 事前チェックリスト）`
      : `## Recurring misses from past tasks (${artifact} pre-writing checklist)`;
  const intro =
    language === 'ja'
      ? '過去のタスクで品質ゲートがタスク横断で繰り返し指摘した観点です。成果物を書く**前に**自己点検し、該当する観点は本文で明示的にカバーしてください。このタスクに該当しない項目は無視して構いません。'
      : 'These viewpoints were repeatedly flagged by the quality gate across past tasks. Self-check BEFORE writing and explicitly cover the applicable ones in the artifact. Ignore items that do not apply to this task.';
  return `${header}\n\n${intro}\n\n${bullets.map((b) => `- [ ] ${b}`).join('\n')}`;
}

/** Distillation system prompt — generalization ONLY, no invented requirements. */
function distillSystemPrompt(phase: CriticPhase): string {
  const artifact = phase === 'research' ? '調査レポート(research.md)' : '実装計画(plan.md)';
  return `あなたは品質レビューの分析者です。入力は、過去のタスクで${artifact}が品質ゲートに指摘された理由の一覧です。
これらを、今後のタスクで成果物を書く前に自己点検できる「一般化されたチェックリスト観点」に要約してください。
厳守事項:
- 提供された指摘の一般化・集約のみを行うこと。一覧に無い新しい要求を発明しない。
- 特定タスク固有の固有名詞（ファイル名・ライブラリ名・プロジェクト名）は残さず、観点として一般化する。
- 繰り返し現れる観点・深刻な観点を優先し、最大${MAX_LESSONS}項目。各項目は1行・80文字以内。
- 出力はJSON配列のみ（前後に説明やコードブロックを付けない）: ["観点1","観点2",...]`;
}

/**
 * Build the cross-task lessons checklist for a phase, distilling (and caching)
 * from recent critic-failure transitions. Fail-soft: any error returns ''.
 *
 * @param phase - 'research' | 'plan'. / 対象フェーズ
 * @param language - Output language. / 出力言語
 * @returns Markdown section for prompt injection, or ''. / 注入用セクション
 */
export async function buildCriticLessonsSection(
  phase: CriticPhase,
  language: 'ja' | 'en' = 'ja',
): Promise<string> {
  if (!isCriticLessonsEnabled()) return '';
  try {
    const rows = await prisma.workflowTransition.findMany({
      where: { cause: { in: [`${phase}_critic_failed`, `${phase}_critic_exhausted`] } },
      orderBy: { createdAt: 'desc' },
      take: SOURCE_WINDOW,
      select: { id: true, taskId: true, metadata: true },
    });

    const reasons: string[] = [];
    const tasks = new Set<number>();
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.metadata) continue;
      try {
        const meta = JSON.parse(row.metadata) as { reasons?: unknown };
        if (!Array.isArray(meta.reasons)) continue;
        for (const r of meta.reasons) {
          if (typeof r !== 'string' || !r.trim() || seen.has(r)) continue;
          seen.add(r);
          reasons.push(r.trim());
          tasks.add(row.taskId);
        }
      } catch {
        // Skip malformed metadata — never fail the whole build on one row.
      }
    }
    // Cross-task requirement: one task's findings are that task's feedback
    // (buildCriticFeedback), not a house-wide lesson.
    if (reasons.length < MIN_REASONS || tasks.size < MIN_TASKS) return '';

    const fingerprint = `${rows[0]?.id ?? 0}:${rows.length}`;
    const cached = cache.get(phase);
    if (cached && cached.fingerprint === fingerprint && Date.now() - cached.at < CACHE_TTL_MS) {
      return renderLessonsSection(cached.bullets, phase, language);
    }

    if (!(await isAnyApiKeyConfigured())) return '';
    const provider = await getDefaultProvider();
    let source = reasons.map((r) => `- ${r}`).join('\n');
    if (source.length > MAX_SOURCE_CHARS) source = source.slice(0, MAX_SOURCE_CHARS);
    const res = await sendAIMessage({
      provider,
      messages: [{ role: 'user', content: source }],
      systemPrompt: distillSystemPrompt(phase),
      maxTokens: 800,
    });
    const bullets = parseLessonsResponse(res.content);
    // Cache even an empty distillation — retrying every prompt build would
    // burn an AI call per failure until the fingerprint changes.
    cache.set(phase, { fingerprint, at: Date.now(), bullets });
    log.info(
      { phase, sourceReasons: reasons.length, sourceTasks: tasks.size, lessons: bullets.length },
      '[critic-lessons] distilled cross-task lessons',
    );
    return renderLessonsSection(bullets, phase, language);
  } catch (err) {
    log.debug({ err, phase }, '[critic-lessons] build failed (skipped)');
    return '';
  }
}
