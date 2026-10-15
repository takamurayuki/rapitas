/**
 * hypothesis-service.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { HypothesisDomain } from './hypothesis-service';
import { HYPOTHESIS_DOMAINS } from './hypothesis-service';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to HypothesisDomain.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid HypothesisDomain. / 有効なHypothesisDomainの場合true
 */
export function isHypothesisDomain(s: unknown): s is HypothesisDomain {
  return isOneOf(s, HYPOTHESIS_DOMAINS);
}

/**
 * Narrows a DB string (or null/undefined) to HypothesisDomain, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'codebase'`. / 無効時に返す値
 * @returns A valid HypothesisDomain. / 有効なHypothesisDomain
 */
export function narrowHypothesisDomain(
  s: string | null | undefined,
  fallback: HypothesisDomain = 'codebase',
): HypothesisDomain {
  return isHypothesisDomain(s) ? s : fallback;
}
