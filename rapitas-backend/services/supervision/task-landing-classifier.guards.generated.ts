/**
 * task-landing-classifier.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { LandingClass } from './task-landing-classifier';
import { LANDING_CLASSES } from './task-landing-classifier';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to LandingClass.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid LandingClass. / 有効なLandingClassの場合true
 */
export function isLandingClass(s: unknown): s is LandingClass {
  return isOneOf(s, LANDING_CLASSES);
}

/**
 * Narrows a DB string (or null/undefined) to LandingClass, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'publish_after_stop'`. / 無効時に返す値
 * @returns A valid LandingClass. / 有効なLandingClass
 */
export function narrowLandingClass(
  s: string | null | undefined,
  fallback: LandingClass = 'publish_after_stop',
): LandingClass {
  return isLandingClass(s) ? s : fallback;
}
