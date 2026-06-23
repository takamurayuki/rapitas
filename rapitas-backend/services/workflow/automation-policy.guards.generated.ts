/**
 * automation-policy.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { LandingMode } from './automation-policy';
import { LANDING_MODES } from './automation-policy';

/**
 * Type guard: narrows an unknown value to LandingMode.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid LandingMode. / 有効なLandingModeの場合true
 */
export function isLandingMode(s: unknown): s is LandingMode {
  return typeof s === 'string' && (LANDING_MODES as readonly string[]).includes(s);
}

/**
 * Narrows a DB string (or null/undefined) to LandingMode, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'none'`. / 無効時に返す値
 * @returns A valid LandingMode. / 有効なLandingMode
 */
export function narrowLandingMode(
  s: string | null | undefined,
  fallback: LandingMode = 'none',
): LandingMode {
  return isLandingMode(s) ? s : fallback;
}
