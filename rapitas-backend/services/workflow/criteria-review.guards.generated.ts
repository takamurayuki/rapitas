/**
 * criteria-review.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { ReviewFindingKind } from './criteria-review';
import { REVIEW_FINDING_KINDS } from './criteria-review';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to ReviewFindingKind.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid ReviewFindingKind. / 有効なReviewFindingKindの場合true
 */
export function isReviewFindingKind(s: unknown): s is ReviewFindingKind {
  return isOneOf(s, REVIEW_FINDING_KINDS);
}

/**
 * Narrows a DB string (or null/undefined) to ReviewFindingKind, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'unverifiable'`. / 無効時に返す値
 * @returns A valid ReviewFindingKind. / 有効なReviewFindingKind
 */
export function narrowReviewFindingKind(
  s: string | null | undefined,
  fallback: ReviewFindingKind = 'unverifiable',
): ReviewFindingKind {
  return isReviewFindingKind(s) ? s : fallback;
}
