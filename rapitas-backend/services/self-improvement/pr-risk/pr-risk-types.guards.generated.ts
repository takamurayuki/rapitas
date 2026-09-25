/**
 * pr-risk-types.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { PrRiskStage, FeatureKey } from './pr-risk-types';
import { PR_RISK_STAGES, FEATURE_KEYS } from './pr-risk-types';

import { isOneOf } from '../../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to PrRiskStage.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid PrRiskStage. / 有効なPrRiskStageの場合true
 */
export function isPrRiskStage(s: unknown): s is PrRiskStage {
  return isOneOf(s, PR_RISK_STAGES);
}

/**
 * Narrows a DB string (or null/undefined) to PrRiskStage, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'off'`. / 無効時に返す値
 * @returns A valid PrRiskStage. / 有効なPrRiskStage
 */
export function narrowPrRiskStage(
  s: string | null | undefined,
  fallback: PrRiskStage = 'off',
): PrRiskStage {
  return isPrRiskStage(s) ? s : fallback;
}

/**
 * Type guard: narrows an unknown value to FeatureKey.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid FeatureKey. / 有効なFeatureKeyの場合true
 */
export function isFeatureKey(s: unknown): s is FeatureKey {
  return isOneOf(s, FEATURE_KEYS);
}

/**
 * Narrows a DB string (or null/undefined) to FeatureKey, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'file_size'`. / 無効時に返す値
 * @returns A valid FeatureKey. / 有効なFeatureKey
 */
export function narrowFeatureKey(
  s: string | null | undefined,
  fallback: FeatureKey = 'file_size',
): FeatureKey {
  return isFeatureKey(s) ? s : fallback;
}
