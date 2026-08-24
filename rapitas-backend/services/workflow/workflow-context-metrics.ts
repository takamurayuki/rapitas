/**
 * Workflow Context Metrics
 *
 * Measures per-section character counts and estimated token counts of the role
 * context assembled by buildRoleContext, and records them once per phase start
 * (one pino line + one TimelineEvent). Read-only: never mutates the context and
 * never lets a recording failure break phase execution.
 */
import { createLogger } from '../../config/logger';
import { appendEvent } from '../memory/timeline';

const log = createLogger('workflow-context-metrics');

/**
 * CONTEXT-SIZE BASELINE — measured 2026-08-18, BEFORE this budget mechanism was
 * enabled (RAPITAS_CONTEXT_BUDGET still defaults to `log`, i.e. measure-only).
 * Committed here in diff-visible form so the slimming effect can be measured
 * later, once `enforce` is switched on. The before/after comparison itself is a
 * separate post-enablement task — this constant is the fixed "before" anchor.
 *
 * HOW TO MEASURE "after": aggregate the same two sources over a comparable
 * window of completed executions and compare against these numbers —
 *   1. `AgentExecution.cacheReadInputTokens` / `.cacheCreationInputTokens` /
 *      `.llmCallCount` (Prisma; written by execution-persistence.ts) → the real
 *      cache-token cost per LLM call and per execution.
 *   2. `TimelineEvent` rows with `eventType='context_section_metrics'` (emitted
 *      by recordContextMetrics below) → per-section chars, so a drop in a
 *      budgeted section's `chars` vs its `rawChars` shows where the slimming
 *      came from.
 */
export const CONTEXT_SIZE_BASELINE = {
  /** Measurement date (ISO 8601). / 計測日 */
  measuredAt: '2026-08-18',
  /** Completed executions in the sampled window. / 完了実行件数 */
  completedExecutions: 415,
  /** Sum of cacheReadInputTokens across the window (~1,481.1M). / cacheRead 合計 */
  cacheReadTotalTokens: 1_481_100_000,
  /** Mean cacheRead per LLM call. / LLM呼び出し1回あたり平均 cacheRead */
  avgCacheReadPerLlmCall: 111_104,
  /** Mean cacheCreation per execution. / 実行1件あたり平均 cacheCreation */
  avgCacheCreationPerExecution: 105_037,
  /** Total LLM calls across the window. / LLM呼び出し合計 */
  totalLlmCalls: 13_331,
} as const;

// NOTE: BMP-only ranges, written as literal characters (equivalent to
// U+3000-303F CJK punctuation, U+3040-30FF kana, U+3400-4DBF / U+4E00-9FFF CJK
// ideographs, U+FF00-FFEF fullwidth forms) — each matched code point ≈ 1 token
// on cl100k-family tokenizers, while other text averages ≈ 4 chars per token.
const CJK_CHAR = /[　-〿぀-ヿ㐀-䶿一-鿿＀-￯]/;

/**
 * A raw/budgeted pair for a section that may be clamped by a token budget.
 * Passing this instead of a bare string records BOTH the pre-budget (raw) and
 * the actually-injected (budgeted) size, so the slimming effect of `enforce`
 * mode is measurable and oversized sections stay identifiable in `log` mode.
 */
export interface BudgetedSection {
  /** Pre-budget text (what would be injected without clamping). / 適用前 */
  raw: string | null | undefined;
  /** Actually-injected text (after budgetSection). / 適用後 */
  budgeted: string | null | undefined;
}

/** A section value: plain text, or a raw/budgeted pair for clamped sections. */
export type SectionValue = string | null | undefined | BudgetedSection;

/** One measured context section (non-empty injected block). */
export interface SectionMetric {
  /** Section name as passed by the builder hook. / セクション名 */
  name: string;
  /** Injected character count — budgeted value when clamped (primary datum). / 文字数（一次データ, 適用後） */
  chars: number;
  /** Estimated token count of the injected text (advisory). / 推定トークン数（参考値） */
  estTokens: number;
  /** Pre-budget char count; present only for budget-eligible sections. / 適用前文字数 */
  rawChars?: number;
  /** Pre-budget estimated tokens; present only for budget-eligible sections. / 適用前推定トークン */
  rawEstTokens?: number;
  /** True when the injected text was actually truncated (raw ≠ budgeted). / 切詰め有無 */
  clamped?: boolean;
}

/** Aggregate metrics for one role context. */
export interface ContextMetrics {
  sections: SectionMetric[];
  totalChars: number;
  totalEstTokens: number;
}

/**
 * Estimate the token count of a text for cl100k-family tokenizers.
 *
 * CJK code points count as ~1 token each; all other code points as ~4 chars
 * per token. The estimate is advisory only — `chars` stays the primary datum,
 * and the effect measurement (要求3) uses the measured `cacheReadInputTokens`.
 *
 * @param text - Text to estimate. / 推定対象テキスト
 * @returns Rounded estimated token count. / 推定トークン数（四捨五入）
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let total = 0;
  for (const ch of text) {
    total += 1;
    if (CJK_CHAR.test(ch)) cjk += 1;
  }
  return Math.round(cjk + (total - cjk) / 4);
}

/**
 * Compute per-section metrics, excluding empty (`''`/null/undefined) sections.
 *
 * @param sections - Section name → injected text. / セクション名→注入文字列
 * @returns Per-section and total counts. / セクション別・合計の計測値
 */
export function computeSectionMetrics(sections: Record<string, SectionValue>): ContextMetrics {
  const measured: SectionMetric[] = [];
  for (const [name, value] of Object.entries(sections)) {
    // Budget-eligible section: record both the pre-budget (raw) and the
    // actually-injected (budgeted) size so slimming is measurable.
    if (value && typeof value === 'object') {
      const raw = value.raw ?? '';
      const budgeted = value.budgeted ?? '';
      if (!raw && !budgeted) continue; // both empty — noise
      measured.push({
        name,
        chars: budgeted.length,
        estTokens: estimateTokens(budgeted),
        rawChars: raw.length,
        rawEstTokens: estimateTokens(raw),
        clamped: raw.length !== budgeted.length,
      });
      continue;
    }
    if (!value) continue; // empty sections are noise — record real injections only
    measured.push({ name, chars: value.length, estTokens: estimateTokens(value) });
  }
  return {
    sections: measured,
    totalChars: measured.reduce((sum, m) => sum + m.chars, 0),
    totalEstTokens: measured.reduce((sum, m) => sum + m.estTokens, 0),
  };
}

/**
 * Record one role context's section metrics (fire-and-forget safe).
 *
 * Emits one pino info line and one `context_section_metrics` TimelineEvent.
 * The whole body is wrapped so the returned promise NEVER rejects — metrics
 * are best-effort and must not break or delay phase execution.
 *
 * @param taskId - Task whose phase is starting. / 対象タスクID
 * @param role - Workflow role about to execute. / 実行ロール
 * @param mode - Resolved workflow mode. / ワークフローモード
 * @param sections - Section name → injected text. / セクション名→注入文字列
 * @returns Resolves always (even on failure). / 常に resolve する
 */
export async function recordContextMetrics(
  taskId: number,
  role: string,
  mode: string,
  sections: Record<string, SectionValue>,
): Promise<void> {
  try {
    const metrics = computeSectionMetrics(sections);
    const payload = {
      taskId,
      role,
      mode,
      sections: metrics.sections,
      totalChars: metrics.totalChars,
      totalEstTokens: metrics.totalEstTokens,
    };
    log.info(payload, '[ContextMetrics] role context section sizes');
    await appendEvent({
      eventType: 'context_section_metrics',
      actorType: 'system',
      payload,
      correlationId: `task_${taskId}`,
    });
  } catch (error) {
    try {
      log.debug({ err: error, taskId, role }, '[ContextMetrics] recording failed (ignored)');
    } catch {
      /* even logging failures must not escape a fire-and-forget hook */
    }
  }
}
