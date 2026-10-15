/**
 * phase-segmentation.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { PhaseType } from './phase-segmentation';
import { PHASE_ORDER } from './phase-segmentation';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to PhaseType.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid PhaseType. / 有効なPhaseTypeの場合true
 */
export function isPhaseType(s: unknown): s is PhaseType {
  return isOneOf(s, PHASE_ORDER);
}

/**
 * Narrows a DB string (or null/undefined) to PhaseType, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'research'`. / 無効時に返す値
 * @returns A valid PhaseType. / 有効なPhaseType
 */
export function narrowPhaseType(
  s: string | null | undefined,
  fallback: PhaseType = 'research',
): PhaseType {
  return isPhaseType(s) ? s : fallback;
}
