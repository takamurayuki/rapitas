/**
 * FileSave Guards
 *
 * Pre-write guards for the workflow file-save pipeline: file-type validation,
 * task resolution, status-transition gating (with re-run fast-forward), and the
 * parent/subtask terminal-state guard.
 * Not responsible for content processing or status auto-transitions.
 */

import { prisma } from '../../../../config';
import { NotFoundError, ValidationError } from '../../../../middleware/error-handler';
import { createLogger } from '../../../../config/logger';
import {
  VALID_FILE_TYPES,
  type WorkflowFileType,
  resolveWorkflowDir,
} from '../../core/workflow-helpers';
import { readWorkflowFile } from '../../../../services/workflow/workflow-file-utils';
import { isReusableArtifact } from '../../../../services/workflow/phase-output-validator';
import { recordTransition } from '../../../../services/workflow/transition-recorder';
import { normalizeWorkflowStatus } from '../../../../services/workflow/workflow-invariants';
import { findRecentCriticBounce } from '../../../../services/workflow/phase-critic';
import type { WorkflowStatus } from '../../../../services/workflow/workflow-types';
import { ALLOWED_FILE_TYPES_BY_STATUS } from './shared';

const log = createLogger('routes:workflow:handlers:files');

/**
 * The non-null result of resolveWorkflowDir — the task snapshot the pipeline
 * stages share. Kept as the helper's own return type (not redefined) so the
 * stages can never drift from the resolver.
 */
export type ResolvedWorkflowTask = NonNullable<Awaited<ReturnType<typeof resolveWorkflowDir>>>;

/**
 * Validates the :fileType route param against the known workflow file types.
 *
 * @param fileTypeParam - Raw fileType route param / ルートパラメータの生値
 * @returns The validated workflow file type / 検証済みファイル種別
 * @throws {ValidationError} When the file type is not one of VALID_FILE_TYPES
 */
export function validateFileType(fileTypeParam: string): WorkflowFileType {
  const fileType = fileTypeParam as WorkflowFileType;
  if (!VALID_FILE_TYPES.includes(fileType)) {
    throw new ValidationError(`Invalid file type. Must be one of: ${VALID_FILE_TYPES.join(', ')}`);
  }
  return fileType;
}

/**
 * Resolves the target task's workflow context or fails with 404.
 *
 * @param taskId - Task to resolve / 対象タスク
 * @returns The resolved workflow context (task + category/theme path)
 * @throws {NotFoundError} When the task does not exist
 */
export async function resolveTargetTask(taskId: number): Promise<ResolvedWorkflowTask> {
  const resolved = await resolveWorkflowDir(taskId);
  if (!resolved) {
    throw new NotFoundError('Task not found');
  }
  return resolved;
}

/**
 * Gates the save against the current workflow status (with re-run fast-forward).
 *
 * NOTE: mutates `resolved.task.workflowStatus` in place when fast-forwarding
 * draft → research_done — the downstream auto-transition logic reads that
 * property to compute the NEXT status, so the in-memory snapshot must stay
 * consistent with the DB update made here.
 *
 * @param taskId - Task being saved to / 対象タスク
 * @param fileType - File type being saved / 保存対象ファイル種別
 * @param resolved - Resolved workflow context (mutated on fast-forward) / 解決済みコンテキスト
 * @returns The status the guard evaluated against (post fast-forward) / ガード適用時のステータス
 * @throws {ValidationError} When the file type is not allowed in the current status
 */
export async function guardStatusTransition(
  taskId: number,
  fileType: WorkflowFileType,
  resolved: ResolvedWorkflowTask,
): Promise<WorkflowStatus> {
  // NOTE: normalizeWorkflowStatus handles null/undefined/empty-string — an empty workflowStatus
  // would cause ALLOWED_FILE_TYPES_BY_STATUS[""] to return undefined and skip the guard entirely.
  let currentStatusForGuard = normalizeWorkflowStatus(resolved.task.workflowStatus);

  // Re-run fast-forward: a re-run resets workflowStatus to draft, but the
  // prior run's research.md still exists — the agent (correctly) skips
  // regenerating it and jumps ahead to plan/verify. Without this the gate
  // below rejects that save (draft only accepts research/question) and the
  // task stalls until someone manually RE-SAVES the unchanged research.md
  // (task 485 re-run). When a valid research.md already exists, advance
  // draft → research_done so the artifact counts without being re-sent.
  // Forward-only, one hop; the plan-approval gate is never skipped, and the
  // completion/verification gates still govern verify.md itself.
  if (currentStatusForGuard === 'draft' && !ALLOWED_FILE_TYPES_BY_STATUS.draft.has(fileType)) {
    const existingResearch = await readWorkflowFile(taskId, 'research').catch(() => null);
    if (existingResearch && isReusableArtifact('research', existingResearch)) {
      await prisma.task
        .update({ where: { id: taskId }, data: { workflowStatus: 'research_done' } })
        .catch(() => {});
      await recordTransition({
        taskId,
        fromStatus: 'draft',
        toStatus: 'research_done',
        actor: 'system',
        cause: 'artifact_reuse_fastforward',
        phase: 'research',
        metadata: { trigger: `save:${fileType}`, reason: 'existing research.md reused' },
      }).catch(() => {});
      currentStatusForGuard = 'research_done';
      // Keep the in-memory snapshot consistent — the auto-transition logic
      // below reads resolved.task.workflowStatus to compute the NEXT status
      // (e.g. plan save at research_done → plan_created).
      resolved.task.workflowStatus = 'research_done';
      log.info(
        { taskId, fileType },
        '[Workflow] Fast-forwarded draft → research_done from existing research.md (re-run reuse; no re-save needed)',
      );
    }
  }

  const allowedForCurrent = ALLOWED_FILE_TYPES_BY_STATUS[currentStatusForGuard];
  if (allowedForCurrent && !allowedForCurrent.has(fileType)) {
    log.warn(
      {
        taskId,
        fileType,
        currentStatus: currentStatusForGuard,
        allowed: Array.from(allowedForCurrent),
      },
      '[Workflow] Rejected workflow file save: invalid status transition',
    );
    // The status usually rolled BACK because the (asynchronous) phase critic
    // bounced the previous artifact — which the in-flight agent never saw,
    // since it had already moved on to this next artifact. Telling it only
    // "wrong phase, reset or wait" leaves it with no legal move: task 585's
    // researcher then burned its remaining wall-clock attempting plan.md and
    // re-submitting the identical research.md. Surface the critic's actual
    // issues plus the one action that works: revise and re-save that phase.
    const bounce = await findRecentCriticBounce(taskId, allowedForCurrent);
    await recordTransition({
      taskId,
      fromStatus: currentStatusForGuard,
      toStatus: currentStatusForGuard,
      actor: 'system',
      cause: 'transition_rejected',
      phase: fileType,
      metadata: {
        attemptedFileType: fileType,
        allowed: Array.from(allowedForCurrent),
        reason: bounce
          ? `rolled back by the ${bounce.phase} critic gate`
          : 'file type not allowed in current workflow status',
        ...(bounce
          ? { criticBouncePhase: bounce.phase, criticReasonCount: bounce.reasons.length }
          : {}),
      },
      invariantViolation: true,
      invariantMessage: `Tried to save ${fileType}.md while status="${currentStatusForGuard}"`,
    });
    if (bounce) {
      const issues = bounce.reasons.length
        ? `\n\n【批評ゲートの指摘（すべて対応すること）】\n${bounce.reasons.map((r) => `- ${r}`).join('\n')}`
        : '';
      throw new ValidationError(
        `${fileType}.md は保存できません。直前の ${bounce.phase}.md が自動品質レビュー（批評ゲート）で不合格となり、` +
          `ワークフローが ${bounce.phase} フェーズへ巻き戻されたためです（これはバグではなく想定内の自己修復動作です）。` +
          `\n\n次に取るべき行動: 下記の指摘に対応した ${bounce.phase}.md を作成し、${bounce.phase} として保存し直してください。` +
          `同じ内容の再提出はブロックされます。${issues}`,
      );
    }
    throw new ValidationError(
      `Invalid workflow transition: status "${currentStatusForGuard}" cannot accept "${fileType}.md". ` +
        `Allowed file types in this phase: [${Array.from(allowedForCurrent).join(', ') || 'none'}]. ` +
        `Reset the task or wait for the correct phase before saving.`,
    );
  }

  return currentStatusForGuard;
}

/**
 * Rejects a verify.md save while the parent still has non-terminal subtasks.
 *
 * A split parent must never be verified/completed while any of its subtasks
 * is still non-terminal. The parent's integration verify.md and terminal
 * status are driven exclusively by subtask-completion-handler once EVERY
 * subtask reaches a terminal state. Accepting a verify.md here (an agent
 * curling it directly, or a "run" button that advanced the parent to
 * in_progress) is exactly what marked task #71 completed with 3 subtasks
 * still 'todo'. Reject before writing anything so no premature verify.md
 * lands on disk.
 *
 * @param taskId - Parent task being saved to / 対象タスク
 * @param fileType - File type being saved (no-op unless 'verify') / 保存対象ファイル種別
 * @param currentStatusForGuard - Status the transition guard evaluated / ガード適用時のステータス
 * @throws {ValidationError} When open subtasks exist for a verify save
 */
export async function guardParentSubtasksTerminal(
  taskId: number,
  fileType: WorkflowFileType,
  currentStatusForGuard: WorkflowStatus,
): Promise<void> {
  if (fileType === 'verify') {
    const TERMINAL = new Set(['done', 'failed', 'cancelled', 'archived']);
    const subtasks = await prisma.task.findMany({
      where: { parentId: taskId },
      select: { id: true, status: true },
    });
    const openSubtasks = subtasks.filter((s) => !TERMINAL.has(s.status));
    if (openSubtasks.length > 0) {
      log.warn(
        { taskId, total: subtasks.length, openIds: openSubtasks.map((s) => s.id) },
        '[Workflow] Rejected verify.md save: parent has non-terminal subtasks',
      );
      await recordTransition({
        taskId,
        fromStatus: currentStatusForGuard,
        toStatus: currentStatusForGuard,
        actor: 'system',
        cause: 'verify_blocked_incomplete_subtasks',
        phase: 'verify',
        metadata: {
          totalSubtasks: subtasks.length,
          openSubtaskIds: openSubtasks.map((s) => s.id),
        },
        invariantViolation: true,
        invariantMessage: `verify.md rejected: ${openSubtasks.length}/${subtasks.length} subtasks not terminal`,
      });
      throw new ValidationError(
        `この親タスクには未完了のサブタスクが ${openSubtasks.length} 件あります（#${openSubtasks
          .map((s) => s.id)
          .join(', #')}）。分割タスクの完了は全サブタスクの完了後に自動で行われます。` +
          `verify.md を親タスクに直接保存して完了させることはできません。`,
      );
    }
  }
}
