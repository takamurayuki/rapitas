/**
 * usage-budget-types.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { UsageBudgetUnit, BudgetLevel, PromptAction } from './usage-budget-types';
import { USAGE_BUDGET_UNITS, BUDGET_LEVELS, PROMPT_ACTIONS } from './usage-budget-types';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to UsageBudgetUnit.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid UsageBudgetUnit. / 有効なUsageBudgetUnitの場合true
 */
export function isUsageBudgetUnit(s: unknown): s is UsageBudgetUnit {
  return isOneOf(s, USAGE_BUDGET_UNITS);
}

/**
 * Narrows a DB string (or null/undefined) to UsageBudgetUnit, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'tokens'`. / 無効時に返す値
 * @returns A valid UsageBudgetUnit. / 有効なUsageBudgetUnit
 */
export function narrowUsageBudgetUnit(
  s: string | null | undefined,
  fallback: UsageBudgetUnit = 'tokens',
): UsageBudgetUnit {
  return isUsageBudgetUnit(s) ? s : fallback;
}

/**
 * Type guard: narrows an unknown value to BudgetLevel.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid BudgetLevel. / 有効なBudgetLevelの場合true
 */
export function isBudgetLevel(s: unknown): s is BudgetLevel {
  return isOneOf(s, BUDGET_LEVELS);
}

/**
 * Narrows a DB string (or null/undefined) to BudgetLevel, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'none'`. / 無効時に返す値
 * @returns A valid BudgetLevel. / 有効なBudgetLevel
 */
export function narrowBudgetLevel(
  s: string | null | undefined,
  fallback: BudgetLevel = 'none',
): BudgetLevel {
  return isBudgetLevel(s) ? s : fallback;
}

/**
 * Type guard: narrows an unknown value to PromptAction.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid PromptAction. / 有効なPromptActionの場合true
 */
export function isPromptAction(s: unknown): s is PromptAction {
  return isOneOf(s, PROMPT_ACTIONS);
}

/**
 * Narrows a DB string (or null/undefined) to PromptAction, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'continue'`. / 無効時に返す値
 * @returns A valid PromptAction. / 有効なPromptAction
 */
export function narrowPromptAction(
  s: string | null | undefined,
  fallback: PromptAction = 'continue',
): PromptAction {
  return isPromptAction(s) ? s : fallback;
}
