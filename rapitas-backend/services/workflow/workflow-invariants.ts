/**
 * workflow-invariants
 *
 * Pure invariants the task + workflow_status + saved artifacts must satisfy
 * after any status mutation. Returns a list of violations rather than
 * throwing so the caller can record them in the transition log and still
 * decide whether to surface as a hard failure.
 *
 * Examples of caught states:
 *   - workflowStatus='plan_created' but plan.md does not exist
 *   - workflowStatus='verify_done' but research.md is missing
 *   - workflowStatus='completed' but task.status is not 'done'
 */
import { prisma } from '../../config/database';
import { WORKFLOW_STATUSES, type WorkflowStatus } from './workflow-types';
import { narrowEnum } from '../../utils/common/type-guards';
import { narrowWorkflowMode } from './workflow-types.guards.generated';

/**
 * Statuses whose required-file list depends on workflowMode's `includePlan`
 * toggle. Every other status (draft, research_done, awaiting_question, ...)
 * has a fixed requirement regardless of mode, so callers can skip resolving
 * the mode entirely for those — avoiding an extra DB round-trip.
 */
const PLAN_SENSITIVE_STATUSES = new Set<WorkflowStatus>([
  'plan_created',
  'plan_approved',
  'in_progress',
  'verify_done',
  'completed',
]);

/**
 * Resolve whether the plan phase applies to a task, i.e. whether plan.md
 * should be counted as a required artifact for `wf`. Lightweight-mode tasks
 * skip the plan phase entirely (see workflow-mode-config.ts), so plan.md is
 * never saved for them and must not be flagged as missing.
 *
 * @param workflowMode - Raw task.workflowMode column value. / タスクの生workflowMode値
 * @param wf - Normalized workflowStatus being checked. / 検査対象の正規化済みステータス
 * @returns True when the plan phase (and thus plan.md) is expected. / planフェーズが必須ならtrue
 */
async function resolveIncludePlan(
  workflowMode: string | null | undefined,
  wf: WorkflowStatus,
): Promise<boolean> {
  if (!PLAN_SENSITIVE_STATUSES.has(wf)) return true;
  const mode = narrowWorkflowMode(workflowMode);
  const { getModeSettings } = await import('./workflow-mode-config');
  const settings = await getModeSettings(mode);
  return settings.includePlan;
}

/** Maps a required-file display name (e.g. "research.md") to its WorkflowFile.fileType. */
function fileTypeOf(fileName: string): string {
  return fileName.replace(/\.md$/, '');
}

export interface Violation {
  /** Stable code so dashboards can group: missing_file / status_mismatch / regression. */
  code: string;
  message: string;
}

/**
 * Normalize a raw workflowStatus value to a valid WorkflowStatus enum member.
 * Empty strings, whitespace-only values, and unrecognised strings are mapped to
 * 'draft' to prevent `ALLOWED_FILE_TYPES_BY_STATUS` from returning `undefined`
 * and skipping the file-type guard entirely.
 *
 * @param s - Raw workflowStatus from DB (may be null, undefined, or empty). / DBから取得した生の値
 * @returns Normalized WorkflowStatus, defaulting to 'draft'. / 正規化済みWorkflowStatus
 */
export function normalizeWorkflowStatus(s?: string | null): WorkflowStatus {
  const t = (s ?? '').trim();
  return narrowEnum(t.length ? t : undefined, WORKFLOW_STATUSES, 'draft');
}

/**
 * Return the list of workflow Markdown files that MUST exist on disk for the
 * given workflowStatus. This is the single source of truth for the
 * status→required-file mapping used by both `checkWorkflowInvariants` and
 * `previewMissingFilesForStatus`.
 *
 * @param status - Normalized workflowStatus string. / 正規化済みワークフローステータス
 * @param includePlan - Whether the task's workflowMode has a plan phase.
 *   Defaults to `true` (the pre-existing, plan-required behavior) so callers
 *   that have not been updated to pass mode still see the old result.
 *   / タスクのworkflowModeがplanフェーズを持つか（既定true=従来挙動）
 * @returns File names that must exist (e.g. ['research.md', 'plan.md']). / 必須ファイル名リスト
 */
export function requiredWorkflowFiles(status: string, includePlan = true): string[] {
  switch (status) {
    case 'research_done':
      return ['research.md'];
    case 'plan_created':
    case 'plan_approved':
    case 'in_progress':
      return includePlan ? ['research.md', 'plan.md'] : ['research.md'];
    case 'verify_done':
    case 'completed':
      return includePlan ? ['research.md', 'plan.md', 'verify.md'] : ['research.md', 'verify.md'];
    default:
      // draft, awaiting_question, and any unknown status require no files.
      return [];
  }
}

/**
 * Preview which required artifacts are missing (no WorkflowFile DB row) for a
 * given status without mutating any state. Used by the manual status update
 * API to pre-check before applying the change.
 *
 * @param taskId - Task to inspect. / 検査対象タスクID
 * @param status - Target workflowStatus to check requirements for. / 対象ステータス
 * @returns List of missing file names (empty = all present). / 不足ファイル名リスト
 */
export async function previewMissingFilesForStatus(
  taskId: number,
  status: string,
): Promise<string[]> {
  const wf = normalizeWorkflowStatus(status);
  let includePlan = true;
  if (PLAN_SENSITIVE_STATUSES.has(wf)) {
    const task = await prisma.task
      .findUnique({ where: { id: taskId }, select: { workflowMode: true } })
      .catch(() => null);
    includePlan = await resolveIncludePlan(task?.workflowMode, wf);
  }
  const required = requiredWorkflowFiles(wf, includePlan);
  if (required.length === 0) return [];

  const present = await prisma.workflowFile
    .findMany({
      where: { taskId, fileType: { in: required.map(fileTypeOf) } },
      select: { fileType: true },
    })
    .catch(() => []);
  const presentTypes = new Set(present.map((f) => f.fileType));
  return required.filter((file) => !presentTypes.has(fileTypeOf(file)));
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
      select: { id: true, status: true, workflowStatus: true, workflowMode: true },
    })
    .catch(() => null);
  if (!task) {
    return [{ code: 'task_not_found', message: `Task ${taskId} not found` }];
  }

  const wf = normalizeWorkflowStatus(task.workflowStatus);
  const includePlan = await resolveIncludePlan(task.workflowMode, wf);
  const required = requiredWorkflowFiles(wf, includePlan);

  // Forward expectations: status implies certain artifacts are saved (DB rows).
  if (required.length > 0) {
    const present = await prisma.workflowFile
      .findMany({
        where: { taskId, fileType: { in: required.map(fileTypeOf) } },
        select: { fileType: true },
      })
      .catch(() => []);
    const presentTypes = new Set(present.map((f) => f.fileType));
    for (const file of required) {
      if (!presentTypes.has(fileTypeOf(file))) {
        violations.push({
          code: 'missing_file',
          message: `workflowStatus="${wf}" but ${file} is missing`,
        });
      }
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
