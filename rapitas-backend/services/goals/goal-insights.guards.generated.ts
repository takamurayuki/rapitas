/**
 * goal-insights.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { InsightPeriod } from './goal-insights';
import { INSIGHT_PERIODS } from './goal-insights';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to InsightPeriod.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid InsightPeriod. / 有効なInsightPeriodの場合true
 */
export function isInsightPeriod(s: unknown): s is InsightPeriod {
  return isOneOf(s, INSIGHT_PERIODS);
}

/**
 * Narrows a DB string (or null/undefined) to InsightPeriod, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'4w'`. / 無効時に返す値
 * @returns A valid InsightPeriod. / 有効なInsightPeriod
 */
export function narrowInsightPeriod(
  s: string | null | undefined,
  fallback: InsightPeriod = '4w',
): InsightPeriod {
  return isInsightPeriod(s) ? s : fallback;
}
