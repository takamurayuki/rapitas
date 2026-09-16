/**
 * supervision-events.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { InterventionSourceKind, ObservationGapReasonKind } from './supervision-events';
import { INTERVENTION_SOURCE_KINDS, OBSERVATION_GAP_REASON_KINDS } from './supervision-events';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to InterventionSourceKind.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid InterventionSourceKind. / 有効なInterventionSourceKindの場合true
 */
export function isInterventionSourceKind(s: unknown): s is InterventionSourceKind {
  return isOneOf(s, INTERVENTION_SOURCE_KINDS);
}

/**
 * Narrows a DB string (or null/undefined) to InterventionSourceKind, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'workflow_transition_user'`. / 無効時に返す値
 * @returns A valid InterventionSourceKind. / 有効なInterventionSourceKind
 */
export function narrowInterventionSourceKind(
  s: string | null | undefined,
  fallback: InterventionSourceKind = 'workflow_transition_user',
): InterventionSourceKind {
  return isInterventionSourceKind(s) ? s : fallback;
}

/**
 * Type guard: narrows an unknown value to ObservationGapReasonKind.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid ObservationGapReasonKind. / 有効なObservationGapReasonKindの場合true
 */
export function isObservationGapReasonKind(s: unknown): s is ObservationGapReasonKind {
  return isOneOf(s, OBSERVATION_GAP_REASON_KINDS);
}

/**
 * Narrows a DB string (or null/undefined) to ObservationGapReasonKind, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'heartbeat_stale'`. / 無効時に返す値
 * @returns A valid ObservationGapReasonKind. / 有効なObservationGapReasonKind
 */
export function narrowObservationGapReasonKind(
  s: string | null | undefined,
  fallback: ObservationGapReasonKind = 'heartbeat_stale',
): ObservationGapReasonKind {
  return isObservationGapReasonKind(s) ? s : fallback;
}
