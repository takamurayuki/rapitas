/**
 * workspace-scope.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { ModelOperation } from './workspace-scope';
import { MODEL_OPERATIONS } from './workspace-scope';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to ModelOperation.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid ModelOperation. / 有効なModelOperationの場合true
 */
export function isModelOperation(s: unknown): s is ModelOperation {
  return isOneOf(s, MODEL_OPERATIONS);
}

/**
 * Narrows a DB string (or null/undefined) to ModelOperation, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'aggregate'`. / 無効時に返す値
 * @returns A valid ModelOperation. / 有効なModelOperation
 */
export function narrowModelOperation(
  s: string | null | undefined,
  fallback: ModelOperation = 'aggregate',
): ModelOperation {
  return isModelOperation(s) ? s : fallback;
}
