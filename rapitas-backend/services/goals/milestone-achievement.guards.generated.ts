/**
 * milestone-achievement.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { MilestoneStatus } from './milestone-achievement';
import { MILESTONE_STATUSES } from './milestone-achievement';

import { isOneOf } from '../../utils/common/type-guards';

/**
 * Type guard: narrows an unknown value to MilestoneStatus.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid MilestoneStatus. / 有効なMilestoneStatusの場合true
 */
export function isMilestoneStatus(s: unknown): s is MilestoneStatus {
  return isOneOf(s, MILESTONE_STATUSES);
}

/**
 * Narrows a DB string (or null/undefined) to MilestoneStatus, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'open'`. / 無効時に返す値
 * @returns A valid MilestoneStatus. / 有効なMilestoneStatus
 */
export function narrowMilestoneStatus(
  s: string | null | undefined,
  fallback: MilestoneStatus = 'open',
): MilestoneStatus {
  return isMilestoneStatus(s) ? s : fallback;
}
