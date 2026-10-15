/**
 * supervision-reason-codes.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { AcceptanceReasonCode } from './supervision-reason-codes';
import { ACCEPTANCE_REASON_CODES } from './supervision-reason-codes';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to AcceptanceReasonCode.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid AcceptanceReasonCode. / 有効なAcceptanceReasonCodeの場合true
 */
export function isAcceptanceReasonCode(s: unknown): s is AcceptanceReasonCode {
  return isOneOf(s, ACCEPTANCE_REASON_CODES);
}

/**
 * Narrows a DB string (or null/undefined) to AcceptanceReasonCode, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'streak_task_count_below_threshold'`. / 無効時に返す値
 * @returns A valid AcceptanceReasonCode. / 有効なAcceptanceReasonCode
 */
export function narrowAcceptanceReasonCode(
  s: string | null | undefined,
  fallback: AcceptanceReasonCode = 'streak_task_count_below_threshold',
): AcceptanceReasonCode {
  return isAcceptanceReasonCode(s) ? s : fallback;
}
