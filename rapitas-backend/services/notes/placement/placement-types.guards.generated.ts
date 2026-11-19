/**
 * placement-types.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { NoteSource, ClientWritableSource } from './placement-types';
import { NOTE_SOURCES, CLIENT_WRITABLE_SOURCES } from './placement-types';

import { isOneOf } from '../../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to NoteSource.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid NoteSource. / 有効なNoteSourceの場合true
 */
export function isNoteSource(s: unknown): s is NoteSource {
  return isOneOf(s, NOTE_SOURCES);
}

/**
 * Narrows a DB string (or null/undefined) to NoteSource, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'manual'`. / 無効時に返す値
 * @returns A valid NoteSource. / 有効なNoteSource
 */
export function narrowNoteSource(
  s: string | null | undefined,
  fallback: NoteSource = 'manual',
): NoteSource {
  return isNoteSource(s) ? s : fallback;
}

/**
 * Type guard: narrows an unknown value to ClientWritableSource.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid ClientWritableSource. / 有効なClientWritableSourceの場合true
 */
export function isClientWritableSource(s: unknown): s is ClientWritableSource {
  return isOneOf(s, CLIENT_WRITABLE_SOURCES);
}

/**
 * Narrows a DB string (or null/undefined) to ClientWritableSource, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'manual'`. / 無効時に返す値
 * @returns A valid ClientWritableSource. / 有効なClientWritableSource
 */
export function narrowClientWritableSource(
  s: string | null | undefined,
  fallback: ClientWritableSource = 'manual',
): ClientWritableSource {
  return isClientWritableSource(s) ? s : fallback;
}
