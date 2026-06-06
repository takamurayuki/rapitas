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
import { detectReplacementLoss } from '../../../utils/common/mojibake-detector';
import { performAutoCommitAndPR } from '../workflow-auto-commit';
import { evaluateCompletionGate } from '../../../services/workflow/completion-gate';
import { recordTransition } from '../../../services/workflow/transition-recorder';
import { checkWorkflowInvariants } from '../../../services/workflow/workflow-invariants';
import { maybeAutoApprovePlan } from '../../../services/workflow/plan-auto-approve';

const log = createLogger('routes:workflow:handlers:files');

/**
 * Whether automatic subtask splitting on plan save is enabled (default: OFF).
 *
 * Disabled by default after it repeatedly broke runs: it created bogus subtasks
 * from plan section headings (no keyword list can cover them all), and a split
 * parent conflicts with the comprehensive single-agent flow (verify gets blocked
 * by "open" subtasks, auto-commit aborts). The single agent completes the work
 * in one session and commits reliably; progress visibility comes from the plan
 * checklist + live execution log + verify.md. Re-enable (for a future,
 * rebuilt subtask-execution chain) with RAPITAS_ENABLE_SUBTASK_SPLIT=1.
 *
 * @returns true when splitting is enabled / 分割が有効か
 */
function isSubtaskSplitEnabled(): boolean {
  const v = (process.env.RAPITAS_ENABLE_SUBTASK_SPLIT || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

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
      // 質問待ち中も同じファイルが書ける（質問解消は別 API か question.md 削除で行う）
      awaiting_question: new Set(['research', 'plan', 'verify', 'question']),
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

    // A split parent must never be verified/completed while any of its subtasks
    // is still non-terminal. The parent's integration verify.md and terminal
    // status are driven exclusively by subtask-completion-handler once EVERY
    // subtask reaches a terminal state. Accepting a verify.md here (an agent
    // curling it directly, or a "run" button that advanced the parent to
    // in_progress) is exactly what marked task #71 completed with 3 subtasks
    // still 'todo'. Reject before writing anything so no premature verify.md
    // lands on disk.
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

    const { dir } = resolved;

    // Accept either a JSON body { content, language } OR a raw text/markdown body.
    // NOTE: agents on Windows used to inline the content into a PowerShell pipeline,
    // where $OutputEncoding defaults to US-ASCII — collapsing every Japanese
    // character to '?' (irreversible). The raw-body path lets the agent write the
    // markdown to a UTF-8 temp file and `curl --data-binary @file`, bypassing shell
    // string encoding entirely. See prompt-builder.ts for the agent-facing steps.
    let content: string;
    let fileLanguage: 'ja' | 'en' = 'ja';
    if (typeof body === 'string') {
      content = body;
    } else {
      const parsedBody = body as { content?: string; language?: 'ja' | 'en' };
      if (parsedBody?.content === undefined || parsedBody?.content === null) {
        throw new ValidationError('content is required');
      }
      content = parsedBody.content;
      fileLanguage = parsedBody.language === 'en' ? 'en' : 'ja';
    }

    // Reject irreversible UTF-8 → '?' replacement mojibake. The original bytes are
    // gone, so there is nothing to "sanitise" — saving it would silently persist
    // garbage. Fail the save and tell the agent to re-send as UTF-8 (the
    // detect → make-it-fix step).
    const loss = detectReplacementLoss(content);
    if (loss.detected) {
      log.warn(
        { taskId, fileType, runs: loss.runs, count: loss.count, longest: loss.longest },
        "[Workflow] Rejected workflow file save: '?'-replacement mojibake detected",
      );
      await recordTransition({
        taskId,
        fromStatus: currentStatusForGuard,
        toStatus: currentStatusForGuard,
        actor: 'system',
        cause: 'mojibake_rejected',
        phase: fileType,
        metadata: { runs: loss.runs, count: loss.count, longest: loss.longest },
        invariantViolation: true,
        invariantMessage: `${fileType}.md rejected: non-ASCII text was replaced by '?' (encoding loss)`,
      });
      set.status = 422;
      return {
        error:
          `保存内容が文字化けしています（日本語が '?' に置換され復元不可）。UTF-8 で再送信してください。` +
          `Windows では PowerShell のパイプ/インライン文字列で curl に渡さないでください（既定の US-ASCII で '?' に潰れます）。` +
          `内容を一時ファイルに UTF-8 で書き出し、'curl.exe -X PUT <url> --data-binary @<file>.md -H "Content-Type: text/markdown; charset=utf-8"' で送ってください。`,
        mojibake: { runs: loss.runs, count: loss.count, longest: loss.longest },
      };
    }

    // Delegate to writeWorkflowFile so the previous version is archived to
    // `_archive/<ts>/` and a `WorkflowFile` metadata row is upserted. Mojibake
    // sanitisation runs inside writeWorkflowFile.
    const savedContent = await writeWorkflowFile(dir, fileType, content, taskId);

    // Auto-update workflowStatus
    let newStatus: string | undefined;
    const currentStatus = resolved.task.workflowStatus;

    log.info(`[Workflow] Processing fileType: ${fileType}, currentStatus: ${currentStatus}`);

    if (fileType === 'research' && (!currentStatus || currentStatus === 'draft')) {
      log.info(`[Workflow] Research completed: setting newStatus to research_done`);
      newStatus = 'research_done';
    } else if (fileType === 'plan' && (!currentStatus || currentStatus === 'research_done')) {
      newStatus = 'plan_created';
    } else if (
      fileType === 'question' &&
      currentStatus &&
      currentStatus !== 'awaiting_question' &&
      currentStatus !== 'completed' &&
      currentStatus !== 'verify_done'
    ) {
      // 質問.md が保存されたらユーザー回答待ち状態に遷移する。
      // 復帰先 status は transition log の metadata.previousStatus に保存しておき、
      // 回答後に呼ばれる resume API（routes/workflow/handlers/workflow-handlers-resume.ts）が
      // この値を読み出して元状態に戻す。
      log.info(`[Workflow] Question saved: transitioning ${currentStatus} → awaiting_question`);
      newStatus = 'awaiting_question';
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
      // awaiting_question への遷移時のみ、復帰先 status を metadata に保存する
      const transitionMetadata: Record<string, unknown> = {
        sizeBytes: savedContent.length,
      };
      if (newStatus === 'awaiting_question' && currentStatus) {
        transitionMetadata.previousStatus = currentStatus;
      }
      await recordTransition({
        taskId,
        fromStatus: currentStatus ?? null,
        toStatus: newStatus,
        actor: 'system',
        cause: `file_saved:${fileType}`,
        phase: fileType,
        metadata: transitionMetadata,
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

    // Auto-split into subtasks when plan.md is saved and task is large enough.
    // Gated OFF by default — see isSubtaskSplitEnabled for why.
    let splitResult: { subtasksCreated: number; subtaskIds: number[] } | null = null;
    if (fileType === 'plan' && newStatus === 'plan_created' && isSubtaskSplitEnabled()) {
      try {
        const { analyzePlanForSplitting, createSubtasksFromPlan } =
          await import('../../../services/workflow/subtask-splitter');
        const analysis = analyzePlanForSplitting(content);
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

          const result = await createSubtasksFromPlan(taskId, analysis, researchContent, content);
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
      // When the plan was split into subtasks the parent must NOT advance to its
      // own implementer phase — the subtasks do the work. Approve without
      // auto-advancing the parent, then enqueue the subtasks for sequential run.
      const approval = await maybeAutoApprovePlan(taskId, fileLanguage, {
        autoAdvance: !splitResult,
      });
      if (approval.autoApproved) {
        newStatus = 'plan_approved';
        autoApproved = true;
        if (splitResult && splitResult.subtaskIds.length > 0) {
          try {
            const { AIOrchestra } = await import('../../../services/workflow/ai-orchestra');
            await AIOrchestra.getInstance().enqueueSubtasksForExecution(taskId);
          } catch (enqErr) {
            log.error(
              { err: enqErr, taskId },
              '[Workflow] Failed to enqueue subtasks for execution after auto-approval',
            );
          }
        }
      }
    }

    // Auto commit and PR creation when saving verify.md.
    //
    // NOTE: reaching here means verify.md passed validation (the failure branch
    // above holds the task at `in_progress`/`blocked` and leaves newStatus
    // undefined). Per the user's request — "verify.md を保存し、問題がなければ
    // ステータスを完了に" — a passing verification now completes the task
    // directly. Auto-commit / PR / merge still run as a BEST-EFFORT side effect
    // (so branches with real changes still get a PR), but completion no longer
    // depends on a PR being published.
    // Completion gate: a passing verify may only complete the task when it is
    // backed by REAL code changes (or verify.md explicitly justifies a no-op).
    // Otherwise it's the silent-skip pattern (agent claimed work it never did —
    // empty diff, no commit) and we block for inspection instead of completing.
    let verifyGateBlocked = false;
    if (fileType === 'verify' && newStatus === 'verify_done') {
      const gateSession = await prisma.agentSession
        .findFirst({
          where: { config: { taskId }, worktreePath: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { worktreePath: true },
        })
        .catch(() => null);
      const completionGate = await evaluateCompletionGate(
        gateSession?.worktreePath ?? null,
        savedContent,
      );
      if (!completionGate.allow) {
        verifyGateBlocked = true;
        await prisma.task
          .update({ where: { id: taskId }, data: { status: 'blocked', updatedAt: new Date() } })
          .catch(() => {});
        await recordTransition({
          taskId,
          fromStatus: 'verify_done',
          toStatus: 'verify_done',
          actor: 'verifier',
          cause: 'verify_no_changes',
          phase: 'verify',
          metadata: { reason: completionGate.reason },
          invariantViolation: true,
          invariantMessage:
            '検証は通過しましたが、実装による変更がありません（verify.md に「変更不要の理由」の明記もなし）。暗黙的な完了を防ぐためタスクをブロックしました。',
        });
        log.warn(
          { taskId, reason: completionGate.reason },
          '[Workflow] verify passed but no code changes and no justification — blocking instead of completing',
        );
      }
    }

    let autoCommitPRResult: Awaited<ReturnType<typeof performAutoCommitAndPR>> = {};
    let taskMarkedDone = false;
    if (fileType === 'verify' && newStatus === 'verify_done' && !verifyGateBlocked) {
      // Best-effort commit/PR/merge — never block completion on its outcome.
      autoCommitPRResult = await performAutoCommitAndPR(taskId, savedContent).catch((err) => {
        log.warn(
          { err, taskId },
          '[Workflow] Auto-commit/PR failed (non-fatal); completing anyway',
        );
        return {} as Awaited<ReturnType<typeof performAutoCommitAndPR>>;
      });
      const commit = autoCommitPRResult.autoCommitResult;
      const pr = autoCommitPRResult.autoPRResult;
      const merge = autoCommitPRResult.autoMergeResult;

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
        cause: 'verify_passed',
        phase: 'verify',
        metadata: { commit: commit?.success, pr: pr?.success, merge: merge?.success },
      });
      log.info(
        { taskId, commitOk: commit?.success, prOk: pr?.success, mergeOk: merge?.success },
        '[Workflow] verify.md passed — task marked done/completed (PR best-effort).',
      );

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
