/**
 * task-spec-requirements.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { Deliverable } from './task-spec-requirements';
import { DELIVERABLES } from './task-spec-requirements';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to Deliverable.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid Deliverable. / 有効なDeliverableの場合true
 */
export function isDeliverable(s: unknown): s is Deliverable {
  return isOneOf(s, DELIVERABLES);
}

/**
 * Narrows a DB string (or null/undefined) to Deliverable, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'pr'`. / 無効時に返す値
 * @returns A valid Deliverable. / 有効なDeliverable
 */
export function narrowDeliverable(
  s: string | null | undefined,
  fallback: Deliverable = 'pr',
): Deliverable {
  return isDeliverable(s) ? s : fallback;
}
