/**
 * note-batch.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { BatchSource } from './note-batch';
import { BATCH_SOURCES } from './note-batch';

import { isOneOf } from '../../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to BatchSource.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid BatchSource. / 有効なBatchSourceの場合true
 */
export function isBatchSource(s: unknown): s is BatchSource {
  return isOneOf(s, BATCH_SOURCES);
}

/**
 * Narrows a DB string (or null/undefined) to BatchSource, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'learning'`. / 無効時に返す値
 * @returns A valid BatchSource. / 有効なBatchSource
 */
export function narrowBatchSource(
  s: string | null | undefined,
  fallback: BatchSource = 'learning',
): BatchSource {
  return isBatchSource(s) ? s : fallback;
}
