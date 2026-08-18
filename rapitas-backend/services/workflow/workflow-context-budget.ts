/**
 * Workflow Context Budget
 *
 * Character-budget clamping for oversized context sections injected by
 * buildRoleContext. Only sections explicitly listed in SECTION_BUDGETS are ever
 * clamped, and only in `enforce` mode — quality-gate inputs (plan / diff /
 * GROUND TRUTH) are structurally exempt because their keys are never listed.
 */

/** Budget application mode, resolved from RAPITAS_CONTEXT_BUDGET. */
export type BudgetMode = 'off' | 'log' | 'enforce';

/**
 * Resolve the budget mode from an environment value.
 *
 * Defaults to `log` (measure only, never clamp) for unset or invalid values —
 * the safe rollout posture: behaviour stays byte-identical until an operator
 * opts into `enforce`.
 *
 * @param env - Raw env value (defaults to RAPITAS_CONTEXT_BUDGET). / 環境変数値
 * @returns The resolved mode. / 解決済みモード
 */
export function resolveBudgetMode(
  env: string | undefined = process.env.RAPITAS_CONTEXT_BUDGET,
): BudgetMode {
  return env === 'off' || env === 'enforce' ? env : 'log';
}

// Per-section character caps applied ONLY in `enforce` mode. Keys are
// `<role>.<section>`. Quality-gate materials (verifier plan/diff/GROUND TRUTH,
// planner research) MUST NEVER be added here — the omission is the guarantee.
export const SECTION_BUDGETS: Record<string, number> = {
  // plan.md restates the needed facts (self-containment rule), so the full
  // research.md is redundant for the implementer WHEN a plan exists.
  'implementer.research': 12000,
  // Bounce feedback front-loads the actionable failures; the tail is history.
  'implementer.verifyFeedback': 8000,
};

/** Result of clamping one section to a character budget. */
export interface ClampResult {
  /** The (possibly truncated) text. / 切詰め後テキスト */
  text: string;
  /** Whether truncation happened. / 切詰めの有無 */
  clamped: boolean;
  /** Character count before clamping. / 元の文字数 */
  originalChars: number;
  /** Characters kept (excluding the marker). / 残した文字数 */
  keptChars: number;
}

/**
 * Clamp a text to `maxChars`, keeping the head (docs front-load conclusions).
 *
 * @param text - Section text. / 対象テキスト
 * @param maxChars - Character budget. / 文字数上限
 * @param marker - Optional custom truncation marker. / 切詰めマーカー
 * @returns Clamp outcome; `text` unchanged when within budget. / 切詰め結果
 */
export function clampSection(text: string, maxChars: number, marker?: string): ClampResult {
  if (text.length <= maxChars) {
    return { text, clamped: false, originalChars: text.length, keptChars: text.length };
  }
  const kept = text.slice(0, maxChars);
  const cut = text.length - maxChars;
  const suffix = marker ?? `\n\n…[truncated: ${cut} chars]`;
  return {
    text: `${kept}${suffix}`,
    clamped: true,
    originalChars: text.length,
    keptChars: maxChars,
  };
}

/**
 * Apply the section budget for `key` under the given mode.
 *
 * `off` / `log` are full passthrough; `enforce` clamps only keys present in
 * SECTION_BUDGETS, so gate-material keys pass through unchanged in every mode.
 *
 * @param mode - Resolved budget mode. / バジェットモード
 * @param key - Section budget key (`<role>.<section>`). / セクションキー
 * @param text - Section text to (maybe) clamp. / 対象テキスト
 * @returns The budgeted text. / 適用後テキスト
 */
export function budgetSection(mode: BudgetMode, key: string, text: string): string {
  if (mode !== 'enforce') return text;
  const cap = SECTION_BUDGETS[key];
  if (cap === undefined) return text;
  return clampSection(text, cap).text;
}
