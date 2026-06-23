/**
 * theme-auto-run-service.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { AutoRunStatus } from './theme-auto-run-service';
import { AUTO_RUN_STATUSES } from './theme-auto-run-service';

/**
 * Type guard: narrows an unknown value to AutoRunStatus.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid AutoRunStatus. / 有効なAutoRunStatusの場合true
 */
export function isAutoRunStatus(s: unknown): s is AutoRunStatus {
  return typeof s === 'string' && (AUTO_RUN_STATUSES as readonly string[]).includes(s);
}
