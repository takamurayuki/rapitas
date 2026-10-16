/**
 * question-operator-action
 *
 * Decides whether a plan-phase question round was WAITING ON A HUMAN rather
 * than the agent asking again, and carries the one metadata key that records
 * the verdict on the question-save transition. Owns only that classification:
 * it does not count rounds, block anything, or decide auto-answer eligibility
 * (question-options-parser.ts's isQuestionBlockEligibleForAutoAnswer does the
 * last one, per-option).
 *
 * Why the distinction exists. The plan-question budget (3 lifetime rounds,
 * workflow-plan-question-guard.ts) is there to stop an agent from asking
 * forever instead of implementing. A question that escalates operator work is
 * not that: the agent cannot clear it by trying harder, so counting it against
 * the same budget makes the task fail whenever the human is slower than the
 * budget. Measured on #1215 (2026-10-14): three rounds consumed the budget,
 * the recommended option of two of them was operator work ("#1214 を develop に
 * マージした後、この plan のまま実装を再開する" and "運用者がプロジェクトルート
 * で @vitest/coverage-v8@2.1.4 を core に追加し…"), and the fourth round — the
 * correct escalation "運用者作業が終わるまで保留にし、実装フェーズを自動で再開
 * しない" — was refused with {"count":3,"limit":3} and the task went blocked.
 */
import type { ParsedQuestion, ParsedQuestionBlock } from './question-options-parser';

/**
 * Key written into the question-save transition's metadata. Read back by the
 * guard, so the two must agree; that is the reason it lives here and not as a
 * literal at either call site.
 */
export const OPERATOR_WAIT_METADATA_KEY = 'operatorWait';

/**
 * Whether a single question can only be resolved by a human doing work.
 *
 * Two shapes qualify, and nothing else:
 *  - the RECOMMENDED option requires operator action (the agent's own verdict
 *    is that a human must act), or
 *  - EVERY option requires it (there is no path the agent can take alone).
 *
 * A question that merely offers an operator-action option alongside one the
 * agent can take is NOT a wait: the agent has a way forward, and treating it
 * as a wait would make question rounds effectively unbounded.
 *
 * @param question - One parsed question. / 対象の質問
 * @returns Whether it waits on human work. / 人の作業待ちか
 */
export function questionWaitsOnOperator(question: ParsedQuestion): boolean {
  const { options } = question;
  if (options.length === 0) return false;
  const recommended = options.find((o) => o.key === question.recommended);
  if (recommended?.requiresOperatorAction === true) return true;
  return options.every((o) => o.requiresOperatorAction === true);
}

/**
 * Whether a question ROUND waits on human work — true when any one of its
 * questions does, because the round cannot be resolved without that human.
 *
 * A `null` block (no `json:options`, or malformed) is NOT a wait: an
 * unparseable question.md must keep consuming the agent budget, or writing a
 * malformed block would become a way to ask without limit.
 *
 * @param block - Parsed `json:options` content, or null. / パース結果（null可）
 * @returns Whether the round waits on human work. / 人の作業待ちか
 */
export function roundWaitsOnOperator(block: ParsedQuestionBlock | null | undefined): boolean {
  if (!block) return false;
  return block.questions.some(questionWaitsOnOperator);
}

/**
 * Read the verdict back off a stored transition's metadata.
 *
 * Absent/unreadable metadata counts as NOT a wait. Rows written before this
 * key existed have none, and reading those as waits would retroactively empty
 * the agent budget for every task that already used it.
 *
 * @param metadata - The transition's metadata column, in any stored shape. / metadata列の値
 * @returns Whether that round was recorded as waiting on human work. / 人の作業待ちとして記録されていたか
 */
export function transitionWaitedOnOperator(metadata: unknown): boolean {
  const value = typeof metadata === 'string' ? safeParse(metadata) : metadata;
  if (!value || typeof value !== 'object') return false;
  return (value as Record<string, unknown>)[OPERATOR_WAIT_METADATA_KEY] === true;
}

/** Parse a JSON metadata column without throwing; SQLite stores it as text. */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
