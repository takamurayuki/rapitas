/**
 * supervision.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { SupervisionCategory } from './supervision';
import { SUPERVISION_CATEGORIES } from './supervision';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to SupervisionCategory.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid SupervisionCategory. / 有効なSupervisionCategoryの場合true
 */
export function isSupervisionCategory(s: unknown): s is SupervisionCategory {
  return isOneOf(s, SUPERVISION_CATEGORIES);
}

/**
 * Narrows a DB string (or null/undefined) to SupervisionCategory, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'held'`. / 無効時に返す値
 * @returns A valid SupervisionCategory. / 有効なSupervisionCategory
 */
export function narrowSupervisionCategory(
  s: string | null | undefined,
  fallback: SupervisionCategory = 'held',
): SupervisionCategory {
  return isSupervisionCategory(s) ? s : fallback;
}
