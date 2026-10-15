/**
 * types.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { DeviationCategory } from './types';
import { DEVIATION_CATEGORIES } from './types';

import { isOneOf } from '../../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to DeviationCategory.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid DeviationCategory. / 有効なDeviationCategoryの場合true
 */
export function isDeviationCategory(s: unknown): s is DeviationCategory {
  return isOneOf(s, DEVIATION_CATEGORIES);
}

/**
 * Narrows a DB string (or null/undefined) to DeviationCategory, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'in_plan'`. / 無効時に返す値
 * @returns A valid DeviationCategory. / 有効なDeviationCategory
 */
export function narrowDeviationCategory(
  s: string | null | undefined,
  fallback: DeviationCategory = 'in_plan',
): DeviationCategory {
  return isDeviationCategory(s) ? s : fallback;
}
