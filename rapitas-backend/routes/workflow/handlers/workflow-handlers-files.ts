/**
 * Workflow File Handlers
 *
 * Route handlers for reading and writing workflow files (research, question, plan, verify).
 * Handles auto-status transitions, auto-approval of plans, and post-verify actions.
 * Not responsible for route registration, status updates, or complexity analysis.
 */

import { join } from 'path';
import { prisma } from '../../../config';
import { NotFoundError, ValidationError, parseId } from '../../../middleware/error-handler';
import { createLogger } from '../../../config/logger';
import { recordWorkflowCompletion } from '../../../services/workflow/learning/workflow-learning-optimizer';
import { extractKnowledgeFromTask } from '../../../services/memory/task-knowledge-extractor';
import {
  VALID_FILE_TYPES,
  type WorkflowFileType,
  resolveWorkflowDir,
  getFileInfo,
} from '../core/workflow-helpers';
import { writeWorkflowFile } from '../../../services/workflow/workflow-file-utils';
import { performAutoCommitAndPR } from '../workflow-auto-commit';
import { recordTransition } from '../../../services/workflow/transition-recorder';
import { checkWorkflowInvariants } from '../../../services/workflow/workflow-invariants';
import { maybeAutoApprovePlan } from '../../../services/workflow/plan-auto-approve';

const log = createLogger('routes:workflow:handlers:files');

/**
 * Handler for GET /tasks/:taskId/files
 * Returns all workflow files and their metadata for a task.
 *
 * @param params - Route params containing taskId / ルートパラメータ
 * @param set - Elysia response set object / Elysiaレスポンス
 * @returns Workflow file list with status and path info
 * @throws {NotFoundError} When task does not exist
 * @throws {ValidationError} When taskId is invalid
 */
export async function handleGetFiles({
  params,
  set,
}: {
  params: { taskId: string };
  set: { status: number };
}) {
  try {
    const taskId = parseId(params.taskId, 'task ID');

    const resolved = await resolveWorkflowDir(taskId);
    if (!resolved) {
      throw new NotFoundError('Task not found');
    }

    const { task, dir, categoryId, themeId } = resolved;

    // Parallel retrieval of 4 file information
    const [research, question, plan, verify] = await Promise.all(
      VALID_FILE_TYPES.map((type) => getFileInfo(join(dir, `${type}.md`), type)),
    );

    return {
      research,
      question,
      plan,
      verify,
      workflowStatus: task.workflowStatus || null,
      path: {
        taskId,
        categoryId,
        themeId,
        dir: `tasks/${categoryId ?? 0}/${themeId ?? 0}/${taskId}`,
      },
    };
  } catch (err) {
    if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
    log.error({ err: err }, 'Error fetching workflow files');
    throw err;
  }
}

/**
 * Handler for PUT /tasks/:taskId/files/:fileType
 * Saves a workflow file and auto-transitions workflow status.
 *
 * @param params - Route params with taskId and fileType / ルートパラメータ
 * @param body - Request body containing content and optional language / リクエストボディ
 * @param set - Elysia response set / Elysiaレスポンス
 * @returns Save result with updated workflow status and optional commit/PR info
 * @throws {ValidationError} When fileType or content is invalid
 * @throws {NotFoundError} When task does not exist
 */
export async function handleSaveFile({
  params,
  body,
  set,
}: {
  params: { taskId: string; fileType: string };
  body: unknown;
  set: { status: number };
}) {
  try {
    const taskId = parseId(params.taskId, 'task ID');

    const fileType = params.fileType as WorkflowFileType;
    if (!VALID_FILE_TYPES.includes(fileType)) {
      throw new ValidationError(
        `Invalid file type. Must be one of: ${VALID_FILE_TYPES.join(', ')}`,
      );
    }

    const resolved = await resolveWorkflowDir(taskId);
    if (!resolved) {
      throw new NotFoundError('Task not found');
    }

    // Reject backward / out-of-order workflow file saves. Past incidents
    // showed agents (especially claude-code with full shell access) calling
    // `curl PUT /workflow/.../files/research` AFTER verify.md was already
    // saved, regressing the task to research_done and corrupting the
    // status machine. Each file type is only allowed when the task is in
    // a phase that can legitimately produce that artifact.
    const ALLOWED_FILE_TYPES_BY_STATUS: Record<string, ReadonlySet<WorkflowFileType>> = {
      draft: new Set(['research', 'question']),
      research_done: new Set(['plan', 'question', 'research']),
      plan_created: new Set(['plan', 'question']),
      plan_approved: new Set(['question']),
      in_progress: new Set(['verify', 'question']),
      verify_done: new Set([]),
      completed: new Set([]),
    };
    const currentStatusForGuard = resolved.task.workflowStatus ?? 'draft';
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
      // Record the rejection so forensic timelines show the agent attempt.
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
          reason: 'file type not allowed in current workflow status',
        },
        invariantViolation: true,
        invariantMessage: `Tried to save ${fileType}.md while status="${currentStatusForGuard}"`,
      });
      throw new ValidationError(
        `Invalid workflow transition: status "${currentStatusForGuard}" cannot accept "${fileType}.md". ` +
          `Allowed file types in this phase: [${Array.from(allowedForCurrent).join(', ') || 'none'}]. ` +
          `Reset the task or wait for the correct phase before saving.`,
      );
    }

    const { dir } = resolved;
    const parsedBody = body as { content: string; language?: 'ja' | 'en' };
    if (!parsedBody?.content && parsedBody?.content !== '') {
      throw new ValidationError('content is required');
    }
    const fileLanguage = (parsedBody?.language === 'en' ? 'en' : 'ja') as 'ja' | 'en';

    // Delegate to writeWorkflowFile so the previous version is archived to
    // `_archive/<ts>/` and a `WorkflowFile` metadata row is upserted. Mojibake
    // sanitisation runs inside writeWorkflowFile.
    const savedContent = await writeWorkflowFile(dir, fileType, parsedBody.content, taskId);

    // Auto-update workflowStatus
    let newStatus: string | undefined;
    const currentStatus = resolved.task.workflowStatus;

    log.info(`[Workflow] Processing fileType: ${fileType}, currentStatus: ${currentStatus}`);

    if (fileType === 'research' && (!currentStatus || currentStatus === 'draft')) {
      log.info(`[Workflow] Research completed: setting newStatus to research_done`);
      newStatus = 'research_done';
    } else if (fileType === 'plan' && (!currentStatus || currentStatus === 'research_done')) {
      newStatus = 'plan_created';
    } else if (fileType === 'verify') {
      // Run the verify validator (catches "claims all-pass but body says
      // failed" hallucinations + explicit ❌ markers). When validation
      // signals a real failure we hold the task at `in_progress` and
      // mark task.status='blocked' so the user notices, instead of
      // silently advancing to verify_done and auto-PR.
      try {
        const { validateVerify } =
          await import('../../../services/workflow/phase-output-validator');
        const verifyValidation = validateVerify(savedContent);
        if (!verifyValidation.ok && verifyValidation.severity >= 80) {
          log.warn(
            { taskId, summary: verifyValidation.summary },
            '[Workflow] verify.md failed validation — blocking task instead of marking verify_done',
          );
          await prisma.task
            .update({ where: { id: taskId }, data: { status: 'blocked', updatedAt: new Date() } })
            .catch(() => {});
          await recordTransition({
            taskId,
            fromStatus: currentStatus ?? null,
            toStatus: currentStatus ?? 'in_progress',
            actor: 'verifier',
            cause: 'verify_validation_failed',
            phase: 'verify',
            metadata: {
              sizeBytes: savedContent.length,
              reason: verifyValidation.summary,
            },
            invariantViolation: true,
            invariantMessage: verifyValidation.summary,
          });
          // newStatus stays undefined — caller skips the verify_done
          // transition + auto-commit/PR pipeline below.
        } else {
          log.info(`[Workflow] Verification saved: setting newStatus to verify_done`);
          newStatus = 'verify_done';
        }
      } catch (err) {
        // Validator failure must not block legitimate verify saves.
        log.warn({ err, taskId }, '[Workflow] verify validator threw, allowing save anyway');
        newStatus = 'verify_done';
      }
    }

    if (newStatus) {
      await prisma.task.update({
        where: { id: taskId },
        data: { workflowStatus: newStatus, updatedAt: new Date() },
      });
      // Record the transition + immediately verify invariants. We log
      // violations but DO NOT throw — the file was already saved on disk
      // and rolling back would create a worse "ghost" state.
      const violations = await checkWorkflowInvariants(taskId);
      await recordTransition({
        taskId,
        fromStatus: currentStatus ?? null,
        toStatus: newStatus,
        actor: 'system',
        cause: `file_saved:${fileType}`,
        phase: fileType,
        metadata: { sizeBytes: savedContent.length },
        invariantViolation: violations.length > 0,
        invariantMessage:
          violations.length > 0
            ? violations.map((v) => `${v.code}:${v.message}`).join(' | ')
            : undefined,
      });
      if (violations.length > 0) {
        log.warn(
          { taskId, violations },
          '[Workflow] Invariant violations detected after status update',
        );
      }
    }

    // Auto-split into subtasks when plan.md is saved and task is large enough
    let splitResult: { subtasksCreated: number; subtaskIds: number[] } | null = null;
    if (fileType === 'plan' && newStatus === 'plan_created') {
      try {
        const { analyzePlanForSplitting, createSubtasksFromPlan } =
          await import('../../../services/workflow/subtask-splitter');
        const analysis = analyzePlanForSplitting(parsedBody.content);
        if (analysis.shouldSplit) {
          log.info(`[Workflow] Task ${taskId} plan triggers split: ${analysis.reason}`);
          // Load research.md for context inheritance
          let researchContent: string | undefined;
          try {
            const researchPath = join(dir, 'research.md');
            const { readFile: rf } = await import('fs/promises');
            researchContent = await rf(researchPath, 'utf-8');
          } catch {
            /* no research.md — non-fatal */
          }

          const result = await createSubtasksFromPlan(taskId, analysis, researchContent);
          if (result.success) {
            splitResult = {
              subtasksCreated: result.subtasksCreated,
              subtaskIds: result.subtaskIds,
            };
            log.info(`[Workflow] Created ${result.subtasksCreated} subtasks for task ${taskId}`);
          }
        }
      } catch (splitErr) {
        log.error({ err: splitErr }, `[Workflow] Subtask splitting failed for task ${taskId}`);
      }
    }

    // Auto-approve when saving plan.md if autoApprovePlan is enabled.
    // Delegates to the shared helper so the orchestrator-driven save
    // path (workflow-cli-executor) and this HTTP path stay in sync.
    let autoApproved = false;
    if (fileType === 'plan' && newStatus === 'plan_created') {
      const approval = await maybeAutoApprovePlan(taskId, fileLanguage);
      if (approval.autoApproved) {
        newStatus = 'plan_approved';
        autoApproved = true;
      }
    }

    // Auto commit and PR creation when saving verify.md.
    //
    // NOTE: workflowStatus="verify_done" means verification has been written.
    // The task itself is marked done, and workflowStatus becomes "completed",
    // only after the downstream commit/PR/merge gate succeeds.
    let autoCommitPRResult: Awaited<ReturnType<typeof performAutoCommitAndPR>> = {};
    let taskMarkedDone = false;
    if (fileType === 'verify' && newStatus === 'verify_done') {
      autoCommitPRResult = await performAutoCommitAndPR(taskId, savedContent);

      // Decide whether to mark the Task itself as done.
      //
      // Hardened rule (per user request: "ステータスの完了をPR作成後にする"):
      // status='done' is set ONLY when a PR has been published. The user
      // can still get auto-merge to terminal completion via auto-merge,
      // but a verify-pass alone never marks done — verification without
      // a PR is just "ready for PR review" and stays in_progress.
      //
      //   - merge attempted → require merge.success
      //   - pr  attempted   → require pr.success
      //   - merge / pr NOT attempted → never auto-done; user must trigger
      //     PR via the existing /agents/parallel-execution/pr-routes
      //     endpoint, which marks done after merge.
      const commit = autoCommitPRResult.autoCommitResult;
      const pr = autoCommitPRResult.autoPRResult;
      const merge = autoCommitPRResult.autoMergeResult;
      const requested = autoCommitPRResult.requested;
      let automationSucceeded = false;
      if (requested?.autoMergePR) automationSucceeded = merge?.success === true;
      else if (requested?.autoCreatePR) automationSucceeded = pr?.success === true;

      if (automationSucceeded) {
        await prisma.task.update({
          where: { id: taskId },
          data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
        });
        taskMarkedDone = true;
        await recordTransition({
          taskId,
          fromStatus: 'verify_done',
          toStatus: 'completed',
          actor: 'system',
          cause: requested?.autoMergePR ? 'auto_merge_succeeded' : 'auto_pr_succeeded',
          phase: 'verify',
          metadata: { commit: commit?.success, pr: pr?.success, merge: merge?.success },
        });
      } else {
        log.info(
          {
            taskId,
            requested,
            commitOk: commit?.success,
            prOk: pr?.success,
            mergeOk: merge?.success,
          },
          '[Workflow] verify.md saved — task remains in_progress until a PR is created (auto or manual). Status will be marked done after PR.',
        );
      }

      // Collect workflow learning data asynchronously (fire-and-forget)
      recordWorkflowCompletion(taskId).catch((err) => {
        log.error({ err, taskId }, 'Failed to record workflow learning data');
      });

      // Auto-extract knowledge on task completion (async)
      extractKnowledgeFromTask(taskId).catch((err) => {
        log.error({ err, taskId }, 'Failed to extract knowledge from task');
      });

      // Extract improvement ideas for IdeaBox (async, Ollama-first)
      import('../../../services/memory/idea-extractor')
        .then(({ extractIdeasFromExecutionLog }) => {
          extractIdeasFromExecutionLog(taskId, savedContent).catch((err) => {
            log.error({ err, taskId }, 'Failed to extract ideas from task');
          });
        })
        .catch(() => {});

      // Record reasoning trace for temporal debugging (async)
      import('../../../services/analytics/temporal-debugger')
        .then(({ recordReasoningTrace }) => {
          // Find the latest execution for this task to record its trace
          prisma.agentExecution
            .findFirst({
              where: { session: { config: { taskId } }, status: 'completed' },
              orderBy: { completedAt: 'desc' },
            })
            .then((exec) => {
              if (exec) recordReasoningTrace(exec.id).catch(() => {});
            })
            .catch(() => {});
        })
        .catch(() => {});
    }

    // Build response
    const response: Record<string, unknown> = {
      success: true,
      fileType,
      path: join(dir, `${fileType}.md`),
      workflowStatus: newStatus || currentStatus,
      autoApproved,
    };

    if (splitResult) {
      response.subtaskSplit = splitResult;
    }

    if (fileType === 'verify' && newStatus === 'verify_done') {
      // Reflect actual DB state — taskMarkedDone gates on
      // commit/PR/merge success above.
      response.taskCompleted = taskMarkedDone;
      response.taskStatus = taskMarkedDone ? 'done' : 'in-progress';
      response.workflowStatus = taskMarkedDone ? 'completed' : 'verify_done';
      if (taskMarkedDone) response.completedAt = new Date().toISOString();

      if (autoCommitPRResult.autoCommitResult)
        response.autoCommit = autoCommitPRResult.autoCommitResult;
      if (autoCommitPRResult.autoPRResult) response.autoPR = autoCommitPRResult.autoPRResult;
      if (autoCommitPRResult.autoMergeResult)
        response.autoMerge = autoCommitPRResult.autoMergeResult;
      if (autoCommitPRResult.worktreeCleanupResult)
        response.worktreeCleanup = autoCommitPRResult.worktreeCleanupResult;
    }

    return response;
  } catch (err) {
    if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
    log.error({ err: err }, 'Error saving workflow file');
    throw err;
  }
}

// NOTE: `_handlePlanAutoApprove` lived here previously. The same logic now
// lives in `services/workflow/plan-auto-approve.ts` so the orchestrator
// path (workflow-cli-executor) and this HTTP handler share a single
// source of truth — preventing drift like the recent "auto-approve does
// not fire when planner saves via writeWorkflowFile" regression.
