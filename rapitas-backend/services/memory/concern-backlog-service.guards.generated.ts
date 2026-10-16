/**
 * concern-backlog-service.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { ConcernType, ConcernSeverity, ConcernStatus } from './concern-backlog-service';
import { CONCERN_TYPES, CONCERN_SEVERITIES, CONCERN_STATUSES } from './concern-backlog-service';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to ConcernType.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid ConcernType. / 有効なConcernTypeの場合true
 */
export function isConcernType(s: unknown): s is ConcernType {
  return isOneOf(s, CONCERN_TYPES);
}

/**
 * Type guard: narrows an unknown value to ConcernSeverity.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid ConcernSeverity. / 有効なConcernSeverityの場合true
 */
export function isConcernSeverity(s: unknown): s is ConcernSeverity {
  return isOneOf(s, CONCERN_SEVERITIES);
}

/**
 * Type guard: narrows an unknown value to ConcernStatus.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid ConcernStatus. / 有効なConcernStatusの場合true
 */
export function isConcernStatus(s: unknown): s is ConcernStatus {
  return isOneOf(s, CONCERN_STATUSES);
}

/**
 * Narrows a DB string (or null/undefined) to ConcernStatus, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'open'`. / 無効時に返す値
 * @returns A valid ConcernStatus. / 有効なConcernStatus
 */
export function narrowConcernStatus(
  s: string | null | undefined,
  fallback: ConcernStatus = 'open',
): ConcernStatus {
  return isConcernStatus(s) ? s : fallback;
}
