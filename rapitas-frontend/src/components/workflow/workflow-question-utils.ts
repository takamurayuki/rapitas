/**
 * workflow-question-utils
 *
 * Pure helpers for the workflow Q&A panel. No React / side effects.
 */

/** Default quick-choice options when the agent asked a free-text question. */
export const DEFAULT_QUESTION_OPTIONS = ['はい', 'いいえ'] as const;

export interface ResolvedQuestionOptions {
  /** Options to render as selectable buttons. */
  options: string[];
  /** True when these are the synthesized defaults (no agent-provided options). */
  isDefault: boolean;
}

/**
 * Resolve the choices to display. Per policy, questions are answered by
 * multiple-choice by DEFAULT: when the agent supplied options we use them; when
 * it asked free-text we synthesize quick yes/no defaults. Free-text entry stays
 * available either way (for "specific user-directed content"), so a default
 * never traps the user.
 *
 * @param agentOptions - Options parsed from the agent's question / エージェント提示の選択肢
 * @returns The options to render and whether they are synthesized / 表示する選択肢と既定かどうか
 */
export function resolveQuestionOptions(
  agentOptions: string[] | null | undefined,
): ResolvedQuestionOptions {
  const cleaned = (agentOptions ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
  if (cleaned.length > 0) return { options: cleaned, isDefault: false };
  return { options: [...DEFAULT_QUESTION_OPTIONS], isDefault: true };
}

/**
 * Seconds remaining until an ISO deadline, or null when no deadline.
 *
 * @param deadlineIso - ISO timestamp the question auto-continues at / 自動継続の期限
 * @param nowMs - Current epoch ms (injectable for tests) / 現在時刻
 * @returns Whole seconds remaining (>= 0), or null / 残り秒数
 */
export function secondsUntil(deadlineIso: string | null | undefined, nowMs: number): number | null {
  if (!deadlineIso) return null;
  const deadline = Date.parse(deadlineIso);
  if (Number.isNaN(deadline)) return null;
  return Math.max(0, Math.round((deadline - nowMs) / 1000));
}
