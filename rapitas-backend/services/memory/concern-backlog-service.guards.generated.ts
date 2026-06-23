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

import type { ConcernType, ConcernSeverity } from './concern-backlog-service';
import { CONCERN_TYPES, CONCERN_SEVERITIES } from './concern-backlog-service';

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
