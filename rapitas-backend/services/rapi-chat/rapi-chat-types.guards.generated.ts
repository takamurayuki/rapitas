/**
 * rapi-chat-types.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { MessageRole, MessageKind } from './rapi-chat-types';
import { MESSAGE_ROLES, MESSAGE_KINDS } from './rapi-chat-types';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to MessageRole.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid MessageRole. / 有効なMessageRoleの場合true
 */
export function isMessageRole(s: unknown): s is MessageRole {
  return isOneOf(s, MESSAGE_ROLES);
}

/**
 * Narrows a DB string (or null/undefined) to MessageRole, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'user'`. / 無効時に返す値
 * @returns A valid MessageRole. / 有効なMessageRole
 */
export function narrowMessageRole(
  s: string | null | undefined,
  fallback: MessageRole = 'user',
): MessageRole {
  return isMessageRole(s) ? s : fallback;
}

/**
 * Type guard: narrows an unknown value to MessageKind.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid MessageKind. / 有効なMessageKindの場合true
 */
export function isMessageKind(s: unknown): s is MessageKind {
  return isOneOf(s, MESSAGE_KINDS);
}

/**
 * Narrows a DB string (or null/undefined) to MessageKind, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'text'`. / 無効時に返す値
 * @returns A valid MessageKind. / 有効なMessageKind
 */
export function narrowMessageKind(
  s: string | null | undefined,
  fallback: MessageKind = 'text',
): MessageKind {
  return isMessageKind(s) ? s : fallback;
}
