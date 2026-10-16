/**
 * idea-box-service.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { IdeaPriority } from './idea-box-service';
import { IDEA_PRIORITIES } from './idea-box-service';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to IdeaPriority.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid IdeaPriority. / 有効なIdeaPriorityの場合true
 */
export function isIdeaPriority(s: unknown): s is IdeaPriority {
  return isOneOf(s, IDEA_PRIORITIES);
}
