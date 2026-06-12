/**
 * workflow-invariants
 *
 * Pure invariants the task + workflow_status + on-disk artifacts must satisfy
 * after any status mutation. Returns a list of violations rather than
 * throwing so the caller can record them in the transition log and still
 * decide whether to surface as a hard failure.
 *
 * Examples of caught states:
 *   - workflowStatus='plan_created' but plan.md does not exist
 *   - workflowStatus='verify_done' but research.md is missing
 *   - workflowStatus='completed' but task.status is not 'done'
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { prisma } from '../../config/database';
import { getTaskWorkflowDir } from './workflow-paths';

export interface Violation {
  /** Stable code so dashboards can group: missing_file / status_mismatch / regression. */
  code: string;
  message: string;
}

/**
 * Normalize a raw workflowStatus value to a safe default.
 * Empty strings and whitespace-only values are treated as 'draft' to prevent
 * `ALLOWED_FILE_TYPES_BY_STATUS[""]` from returning `undefined` and skipping
 * the file-type guard entirely.
 *
 * @param s - Raw workflowStatus from DB (may be null, undefined, or empty). / DBから取得した生の値
 * @returns Normalized status string, defaulting to 'draft'. / 正規化済みステータス
 */
export function normalizeWorkflowStatus(s?: string | null): string {
  if (s && s.trim().length > 0) return s.trim();
  return 'draft';
}

/**
 * Return the list of workflow Markdown files that MUST exist on disk for the
 * given workflowStatus. This is the single source of truth for the
 * status→required-file mapping used by both `checkWorkflowInvariants` and
 * `previewMissingFilesForStatus`.
 *
 * @param status - Normalized workflowStatus string. / 正規化済みワークフローステータス
 * @returns File names that must exist (e.g. ['research.md', 'plan.md']). / 必須ファイル名リスト
 */
export function requiredWorkflowFiles(status: string): string[] {
  switch (status) {
    case 'research_done':
      return ['research.md'];
    case 'plan_created':
    case 'plan_approved':
    case 'in_progress':
      return ['research.md', 'plan.md'];
    case 'verify_done':
    case 'completed':
      return ['research.md', 'plan.md', 'verify.md'];
    default:
      // draft, awaiting_question, and any unknown status require no files.
      return [];
  }
}

/**
 * Preview which required files are missing on disk for a given status without
 * mutating any state. Used by the manual status update API to pre-check before
 * applying the change.
 *
 * @param taskId - Task to inspect. / 検査対象タスクID
 * @param status - Target workflowStatus to check requirements for. / 対象ステータス
 * @returns List of missing file names (empty = all present). / 不足ファイル名リスト
 */
export async function previewMissingFilesForStatus(
  taskId: number,
  status: string,
): Promise<string[]> {
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { themeId: true, theme: { select: { categoryId: true } } },
    })
    .catch(() => null);
  if (!task) return [];

  const dir = getTaskWorkflowDir(task.theme?.categoryId ?? null, task.themeId ?? null, taskId);
  const required = requiredWorkflowFiles(normalizeWorkflowStatus(status));
  return required.filter((file) => !existsSync(join(dir, file)));
}

/**
 * Verify the on-disk artifacts and DB columns line up with `workflowStatus`.
 *
 * @param taskId - Task to verify. / 検査対象タスクID
 * @returns Empty array when consistent, otherwise a list of violations. / 違反リスト
 */
export async function checkWorkflowInvariants(taskId: number): Promise<Violation[]> {
  const violations: Violation[] = [];
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        workflowStatus: true,
        themeId: true,
        theme: { select: { categoryId: true } },
      },
    })
    .catch(() => null);
  if (!task) {
    return [{ code: 'task_not_found', message: `Task ${taskId} not found` }];
  }
  const dir = getTaskWorkflowDir(task.theme?.categoryId ?? null, task.themeId ?? null, taskId);
  const has = (file: string) => existsSync(join(dir, file));

  const wf = normalizeWorkflowStatus(task.workflowStatus);

  // Forward expectations: status implies certain files are on disk.
  for (const file of requiredWorkflowFiles(wf)) {
    if (!has(file)) {
      violations.push({
        code: 'missing_file',
        message: `workflowStatus="${wf}" but ${file} is missing on disk`,
      });
    }
  }

  // Cross-column consistency.
  if (wf === 'completed' && task.status !== 'done') {
    violations.push({
      code: 'status_mismatch',
      message: `workflowStatus="completed" but task.status="${task.status}" (expected "done")`,
    });
  }

  // A split parent must not be terminal while any subtask is still non-terminal.
  // Catches the premature-completion regression where the HTTP verify path
  // finalized a parent (e.g. task #71) with subtasks still 'todo'.
  if (wf === 'completed' || wf === 'verify_done') {
    const openSubtasks = await prisma.task
      .count({
        where: { parentId: taskId, status: { notIn: ['done', 'failed', 'cancelled', 'archived'] } },
      })
      .catch(() => 0);
    if (openSubtasks > 0) {
      violations.push({
        code: 'incomplete_subtasks',
        message: `workflowStatus="${wf}" but ${openSubtasks} subtask(s) are still non-terminal`,
      });
    }
  }

  return violations;
}
