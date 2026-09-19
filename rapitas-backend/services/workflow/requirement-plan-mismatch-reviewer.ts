/**
 * Requirement-Plan Mismatch Reviewer
 *
 * The path-name-independent half of task 909's requirement/plan mismatch
 * detection: `.supervisor/` (verify-requirement-plan-mismatch.ts) proves a
 * mismatch structurally and needs no AI. Everything else — a description
 * that states a legitimate future requirement the plan explicitly excludes,
 * or a past investigation narrative that must NOT become an obligation — has
 * no such structural signal, so an AI review is asked to point at the exact
 * sentence in the task description that grounds its verdict.
 *
 * The AI's self-report is never trusted on its own: a `mismatch` verdict is
 * downgraded to `unknown` unless its quoted source text is actually found
 * (normalized) inside the task description. This is what stops the module
 * from re-introducing the exact defect task 909 was filed over — treating a
 * plausible-sounding narrative as grounds for requirement enforcement.
 */
import { createLogger } from '../../config/logger';
import { sendAIMessage, getDefaultProvider, isAnyApiKeyConfigured } from '../../utils/ai-client';

const log = createLogger('workflow:requirement-plan-mismatch-reviewer');

/** Verdict for one acceptance criterion against the current plan. */
export type RequirementPlanMismatchVerdict = 'mismatch' | 'no_mismatch' | 'unknown';

/** Result of {@link reviewRequirementPlanMismatch}. */
export interface RequirementPlanMismatchReview {
  verdict: RequirementPlanMismatchVerdict;
  /** The exact description sentence grounding a `mismatch` verdict, or null. / 根拠として引用した原文 */
  sourceQuote: string | null;
  reason: string;
}

const SYSTEM_PROMPT = `あなたはソフトウェア開発タスクの受入基準と実装計画の整合性をレビューするアシスタントです。
与えられた「タスクの説明」「対象の受入基準」「現在の計画」を読み、対象の受入基準が計画で対応されていない正当な未来の実装要求なのか、それとも計画に含める必要のない過去の調査記録・再現手順の記述にすぎないのかを判定してください。

判定ルール:
- 対象の受入基準を裏付ける具体的な一文が「タスクの説明」に一字一句そのまま存在する場合のみ、その一文を sourceQuote に引用し verdict を "mismatch" にできる。
- 過去に行った調査・再現・検証の手順を語る記述（「〜を確認した」「〜を再現した」「〜を撤去した」等の過去形の記述）は実装義務ではないため "no_mismatch" とする。
- 対象の受入基準を裏付ける一文をタスクの説明から一字一句引用できない場合は "unknown" とする。推測や言い換えでの引用は禁止。
- 現在の計画が既に対象の受入基準に対応している場合は "no_mismatch" とする。

出力は必ず次のJSONのみ。前後に説明文やコードブロックを付けないこと:
{"verdict":"mismatch"|"no_mismatch"|"unknown","sourceQuote":"引用した一文またはnull","reason":"判定理由を1文で"}`;

/** Removes punctuation/whitespace differences so AI quoting noise (trailing 句点, line breaks) doesn't defeat the source-quote check. */
function normalizeForQuoteMatch(text: string): string {
  return text.replace(/[\s、。，．,.!?！？「」『』（）()]/g, '');
}

/** Whether `quote` is actually present in `description`, tolerant of punctuation/whitespace noise. */
function quoteFoundInDescription(description: string, quote: string): boolean {
  const trimmed = quote.trim();
  if (!trimmed) return false;
  if (description.includes(trimmed)) return true;
  return normalizeForQuoteMatch(description).includes(normalizeForQuoteMatch(trimmed));
}

/** Parses the AI response (expected JSON object) into a review result, downgrading unverifiable mismatches to `unknown`. */
function parseReview(content: string, description: string): RequirementPlanMismatchReview {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return { verdict: 'unknown', sourceQuote: null, reason: 'parse_error' };
  try {
    const parsed = JSON.parse(match[0]) as {
      verdict?: unknown;
      sourceQuote?: unknown;
      reason?: unknown;
    };
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
    const sourceQuote = typeof parsed.sourceQuote === 'string' ? parsed.sourceQuote.trim() : '';
    if (parsed.verdict === 'mismatch') {
      if (sourceQuote && quoteFoundInDescription(description, sourceQuote)) {
        return { verdict: 'mismatch', sourceQuote, reason };
      }
      // The AI could not (or did not) ground its verdict in the actual
      // description text — never trust an ungrounded mismatch (task 909's
      // core failure mode: investigation narrative mistaken for a
      // requirement).
      return { verdict: 'unknown', sourceQuote: null, reason: 'ungrounded_source_quote' };
    }
    if (parsed.verdict === 'no_mismatch') {
      return { verdict: 'no_mismatch', sourceQuote: null, reason };
    }
    return { verdict: 'unknown', sourceQuote: sourceQuote || null, reason: reason || 'unknown' };
  } catch {
    return { verdict: 'unknown', sourceQuote: null, reason: 'parse_error' };
  }
}

/**
 * Review whether one acceptance criterion is a legitimate requirement the
 * current plan fails to address, or investigation narrative that must not be
 * enforced. Never throws — every failure path (no AI configured, API error,
 * unparsable response, ungrounded quote) resolves to `unknown`, and callers
 * treat `unknown` the same as `no_mismatch` (do not replan).
 *
 * @param params - The criterion under review, its task's full description, and the current plan. / レビュー入力
 * @returns The verdict, its grounding quote (if any), and a one-line reason. / レビュー結果
 */
export async function reviewRequirementPlanMismatch(params: {
  description: string;
  criterion: string;
  currentPlan: string;
}): Promise<RequirementPlanMismatchReview> {
  const { description, criterion, currentPlan } = params;

  if (!(await isAnyApiKeyConfigured())) {
    return { verdict: 'unknown', sourceQuote: null, reason: 'ai_unavailable' };
  }

  const basis = [
    '# タスクの説明',
    description || '(説明なし)',
    '',
    '# 対象の受入基準',
    criterion,
    '',
    '# 現在の計画',
    currentPlan || '(計画なし)',
  ].join('\n');

  try {
    const provider = await getDefaultProvider();
    const response = await sendAIMessage({
      provider,
      messages: [{ role: 'user', content: basis }],
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 1024,
    });
    return parseReview(response.content, description);
  } catch (error) {
    log.warn(
      { err: error },
      '[requirement-plan-mismatch-reviewer] review failed — treating as unknown',
    );
    return { verdict: 'unknown', sourceQuote: null, reason: 'ai_error' };
  }
}
