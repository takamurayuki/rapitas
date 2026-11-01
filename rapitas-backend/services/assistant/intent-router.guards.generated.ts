/**
 * intent-router.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { RoutableIntent } from './intent-router';
import { ROUTABLE_INTENTS } from './intent-router';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to RoutableIntent.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid RoutableIntent. / 有効なRoutableIntentの場合true
 */
export function isRoutableIntent(s: unknown): s is RoutableIntent {
  return isOneOf(s, ROUTABLE_INTENTS);
}

/**
 * Narrows a DB string (or null/undefined) to RoutableIntent, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'watch'`. / 無効時に返す値
 * @returns A valid RoutableIntent. / 有効なRoutableIntent
 */
export function narrowRoutableIntent(
  s: string | null | undefined,
  fallback: RoutableIntent = 'watch',
): RoutableIntent {
  return isRoutableIntent(s) ? s : fallback;
}
