/**
 * deliverable-completion.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { CompletionMode } from './deliverable-completion';
import { COMPLETION_MODES } from './deliverable-completion';

import { isOneOf } from '../../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to CompletionMode.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid CompletionMode. / 有効なCompletionModeの場合true
 */
export function isCompletionMode(s: unknown): s is CompletionMode {
  return isOneOf(s, COMPLETION_MODES);
}

/**
 * Narrows a DB string (or null/undefined) to CompletionMode, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'manual'`. / 無効時に返す値
 * @returns A valid CompletionMode. / 有効なCompletionMode
 */
export function narrowCompletionMode(
  s: string | null | undefined,
  fallback: CompletionMode = 'manual',
): CompletionMode {
  return isCompletionMode(s) ? s : fallback;
}
