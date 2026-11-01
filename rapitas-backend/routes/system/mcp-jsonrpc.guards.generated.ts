/**
 * mcp-jsonrpc.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { ProtocolVersion } from './mcp-jsonrpc';
import { SUPPORTED_PROTOCOL_VERSIONS } from './mcp-jsonrpc';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to ProtocolVersion.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid ProtocolVersion. / 有効なProtocolVersionの場合true
 */
export function isProtocolVersion(s: unknown): s is ProtocolVersion {
  return isOneOf(s, SUPPORTED_PROTOCOL_VERSIONS);
}

/**
 * Narrows a DB string (or null/undefined) to ProtocolVersion, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'2026-07-28'`. / 無効時に返す値
 * @returns A valid ProtocolVersion. / 有効なProtocolVersion
 */
export function narrowProtocolVersion(
  s: string | null | undefined,
  fallback: ProtocolVersion = '2026-07-28',
): ProtocolVersion {
  return isProtocolVersion(s) ? s : fallback;
}
