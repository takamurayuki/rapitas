/**
 * delete-filter.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { FilterableStatus } from './delete-filter';
import { FILTERABLE_STATUSES } from './delete-filter';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to FilterableStatus.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid FilterableStatus. / 有効なFilterableStatusの場合true
 */
export function isFilterableStatus(s: unknown): s is FilterableStatus {
  return isOneOf(s, FILTERABLE_STATUSES);
}

/**
 * Narrows a DB string (or null/undefined) to FilterableStatus, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'done'`. / 無効時に返す値
 * @returns A valid FilterableStatus. / 有効なFilterableStatus
 */
export function narrowFilterableStatus(
  s: string | null | undefined,
  fallback: FilterableStatus = 'done',
): FilterableStatus {
  return isFilterableStatus(s) ? s : fallback;
}
