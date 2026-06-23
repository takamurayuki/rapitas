/**
 * workflow-types.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { WorkflowRole } from './workflow-types';
import { WORKFLOW_ROLES } from './workflow-types';

/**
 * Type guard: narrows an unknown value to WorkflowRole.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid WorkflowRole. / 有効なWorkflowRoleの場合true
 */
export function isWorkflowRole(s: unknown): s is WorkflowRole {
  return typeof s === 'string' && (WORKFLOW_ROLES as readonly string[]).includes(s);
}

/**
 * Narrows a DB string (or null/undefined) to WorkflowRole, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'researcher'`. / 無効時に返す値
 * @returns A valid WorkflowRole. / 有効なWorkflowRole
 */
export function narrowWorkflowRole(
  s: string | null | undefined,
  fallback: WorkflowRole = 'researcher',
): WorkflowRole {
  return isWorkflowRole(s) ? s : fallback;
}
