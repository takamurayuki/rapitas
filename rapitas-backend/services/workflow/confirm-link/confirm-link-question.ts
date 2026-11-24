/**
 * confirm-link-question
 *
 * Reads the pending question.md for a confirm link: whether the question is
 * a single two-way choice a link may answer (Q1), and the answer text in the
 * same format the frontend's composeStructuredAnswer sends. Not responsible
 * for applying the answer.
 */
import { parseQuestionOptionsBlock, type ParsedQuestion } from '../question-options-parser';

/** Why a question cannot be answered through a link, or null when it can. */
export type ConfirmLinkIneligibleReason =
  | 'no_options_block'
  | 'not_single_question'
  | 'not_two_options'
  | 'free_text_required'
  | 'operator_or_gate_option';

/**
 * Parse question.md and return the one question a link may answer.
 *
 * @param content - question.md body, or null / question.md 本文
 * @returns The question, or the reason it is ineligible / 対象の質問または不適格理由
 */
export function resolveLinkableQuestion(
  content: string | null,
): { ok: true; question: ParsedQuestion } | { ok: false; reason: ConfirmLinkIneligibleReason } {
  const block = content ? parseQuestionOptionsBlock(content) : null;
  if (!block) return { ok: false, reason: 'no_options_block' };
  if (block.questions.length !== 1) return { ok: false, reason: 'not_single_question' };
  const question = block.questions[0];
  if (question.freeTextRequired) return { ok: false, reason: 'free_text_required' };
  if (question.options.length !== 2) return { ok: false, reason: 'not_two_options' };
  // An unauthenticated outsider may not change a gate or claim operator work was done.
  if (question.options.some((o) => o.mutatesGate || o.requiresOperatorAction)) {
    return { ok: false, reason: 'operator_or_gate_option' };
  }
  return { ok: true, question };
}

/**
 * Compose the answer body for the chosen option.
 * NOTE: keep in sync with composeStructuredAnswer in
 * rapitas-frontend/src/components/workflow/workflow-question-utils.ts.
 *
 * @param question - The linked question / 対象の質問
 * @param key - Chosen option key / 選択されたキー
 * @returns The answer text, or null when the key is not an option / 回答本文
 */
export function composeLinkAnswer(question: ParsedQuestion, key: string): string | null {
  const option = question.options.find((o) => o.key === key);
  if (!option) return null;
  const body = option.consequence
    ? `選択: ${option.label}（影響: ${option.consequence}）`
    : `選択: ${option.label}`;
  return `## ${question.id}: ${question.summary}\n${body}`;
}

/**
 * Normalise a self-reported respondent name: strip control characters, trim,
 * and require 1 to 50 characters.
 *
 * @param raw - Submitted value / 送信値
 * @returns The name, or null when invalid / 正規化した名前
 */
export function normalizeRespondentName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return name.length >= 1 && name.length <= 50 ? name : null;
}
