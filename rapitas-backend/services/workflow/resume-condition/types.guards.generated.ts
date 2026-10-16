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

import type { ResumableReason } from './types';
import { RESUMABLE_REASONS } from './types';

import { isOneOf } from '../../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to ResumableReason.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid ResumableReason. / 有効なResumableReasonの場合true
 */
export function isResumableReason(s: unknown): s is ResumableReason {
  return isOneOf(s, RESUMABLE_REASONS);
}

/**
 * Narrows a DB string (or null/undefined) to ResumableReason, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'retry_cap_exhausted'`. / 無効時に返す値
 * @returns A valid ResumableReason. / 有効なResumableReason
 */
export function narrowResumableReason(
  s: string | null | undefined,
  fallback: ResumableReason = 'retry_cap_exhausted',
): ResumableReason {
  return isResumableReason(s) ? s : fallback;
}
