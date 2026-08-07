/**
 * Workflow File Handlers
 *
 * Route handlers for reading and writing workflow files (research, question, plan, verify).
 * Handles auto-status transitions, auto-approval of plans, and post-verify actions.
 * Not responsible for route registration, status updates, or complexity analysis.
 */

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
import {
  writeWorkflowFile,
  readWorkflowFile,
  sliceFromReportHeading,
} from '../../../services/workflow/workflow-file-utils';
import { detectReplacementLoss } from '../../../utils/common/mojibake-detector';
import {
  looksLogPolluted,
  isReusableArtifact,
} from '../../../services/workflow/phase-output-validator';
import { performAutoCommitAndPR, isNoChangeCompletion } from '../workflow-auto-commit';
import { resolveLandingMode } from '../../../services/workflow/automation-policy';
import {
  evaluateCompletionGate,
  researchConcludesNoChange,
} from '../../../services/workflow/completion-gate';
import { recordTransition } from '../../../services/workflow/transition-recorder';
import {
  checkWorkflowInvariants,
  normalizeWorkflowStatus,
} from '../../../services/workflow/workflow-invariants';
import type { WorkflowStatus } from '../../../services/workflow/workflow-types';
import { maybeAutoApprovePlan } from '../../../services/workflow/plan-auto-approve';
import { HTTP_STATUS } from '../../../utils/common/http-status';
import { resolvePreferredBaseBranch } from '../../../services/task/task-resolver';

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
 * Marks a task's latest agent execution (and session) failed with a reason.
 *
 * When a verify is rejected (validation or the automated gate) the task is set
 * `blocked`, but the agent's execution row stays `completed` — so the execution
 * log viewer shows 「完了」 while the task is blocked (the confusing status gap).
 * Aligning the execution/session to `failed` closes that gap.
 *
 * @param taskId - Task whose latest execution to fail / 対象タスク
 * @param message - Failure reason shown in the viewer / 失敗理由
 */
async function markLatestExecutionFailed(taskId: number, message: string): Promise<void> {
  try {
    const session = await prisma.agentSession.findFirst({
      where: { config: { taskId } },
      orderBy: { createdAt: 'desc' },
      include: { agentExecutions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!session) return;
    const exec = session.agentExecutions[0];
    if (exec && exec.status !== 'failed') {
      await prisma.agentExecution
        .update({
          where: { id: exec.id },
          data: { status: 'failed', errorMessage: message, completedAt: new Date() },
        })
        .catch(() => {});
    }
    if (session.status !== 'failed') {
      await prisma.agentSession
        .update({ where: { id: session.id }, data: { status: 'failed', errorMessage: message } })
        .catch(() => {});
    }
  } catch (err) {
    log.warn({ err, taskId }, '[Workflow] Failed to mark latest execution failed');
  }
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
  set: _set,
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

    const { task, categoryId, themeId } = resolved;

    // Parallel retrieval of 4 file information
    const [research, question, plan, verify] = await Promise.all(
      VALID_FILE_TYPES.map((type) => getFileInfo(taskId, type)),
    );

    return {
      research,
      question,
      plan,
      verify,
      workflowStatus: task.workflowStatus || null,
      path: { taskId, categoryId, themeId },
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
    const ALLOWED_FILE_TYPES_BY_STATUS: Record<WorkflowStatus, ReadonlySet<WorkflowFileType>> = {
      draft: new Set(['research', 'question']),
      // 'verify' is allowed here for the LIGHTWEIGHT single-session flow
      // (research→implement→verify, NO plan phase — e.g. conflict-resolution
      // tasks): one agent reaches verify.md while workflowStatus is still
      // research_done, because no plan phase ever advanced it to plan_approved.
      // Without this the save is rejected and the agent must manually PUT
      // /status to in_progress first. Forward-only; the completion gate
      // (evaluateCompletionGate) still blocks completions with no real diff.
      research_done: new Set(['plan', 'question', 'research', 'verify']),
      plan_created: new Set(['plan', 'question']),
      // 'verify' is allowed here for the dev-mode single-session flow: ONE agent
      // does research→plan→implement→verify in a single run, so it reaches
      // verify.md while workflowStatus is still plan_approved (no separate
      // implementer PHASE ever advanced it to in_progress). Hard-rejecting it
      // surfaced a ValidationError in the UI and stranded the run with no
      // commit/PR. Forward-only; the completion gate (evaluateCompletionGate)
      // still blocks completions that have no real code diff.
      plan_approved: new Set(['verify', 'question']),
      in_progress: new Set(['verify', 'question']),
      // 質問待ち中も同じファイルが書ける（質問解消は別 API か question.md 削除で行う）
      awaiting_question: new Set(['research', 'plan', 'verify', 'question']),
      verify_done: new Set([]),
      completed: new Set([]),
    };
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

    // Strip any conversational preamble the agent wrote before the report body
    // (e.g. "これで必要な調査が完了しました。以下がresearch.mdです。"). The .md
    // should begin with its report heading; slice from there. No-op when a heading
    // already leads or none is present.
    content = sliceFromReportHeading(content, fileType);

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
      set.status = HTTP_STATUS.UNPROCESSABLE_ENTITY;
      return {
        error:
          `保存内容が文字化けしています（日本語が '?' に置換され復元不可）。UTF-8 で再送信してください。` +
          `Windows では PowerShell のパイプ/インライン文字列で curl に渡さないでください（既定の US-ASCII で '?' に潰れます）。` +
          `内容を一時ファイルに UTF-8 で書き出し、'curl.exe -X PUT <url> --data-binary @<file>.md -H "Content-Type: text/markdown; charset=utf-8"' で送ってください。`,
        mojibake: { runs: loss.runs, count: loss.count, longest: loss.longest },
      };
    }

    // Reject a "broken" md whose body is the agent's streamed execution log /
    // stream-json rather than a real report. Persisting it would let a corrupted
    // plan.md get auto-approved and implemented against (and reused on re-run).
    // Don't write it, don't advance — the phase re-runs and regenerates a clean
    // file. (verify validation has its own self-repair path; here we stop the
    // garbage at the door for every file type.)
    if (looksLogPolluted(content)) {
      log.warn(
        { taskId, fileType, currentStatus: currentStatusForGuard, chars: content.length },
        '[Workflow] Rejected workflow file save: agent log/stream output leaked into the md',
      );
      await recordTransition({
        taskId,
        fromStatus: currentStatusForGuard,
        toStatus: currentStatusForGuard,
        actor: 'system',
        cause: 'log_polluted_rejected',
        phase: fileType,
        metadata: { chars: content.length },
        invariantViolation: true,
        invariantMessage: `${fileType}.md rejected: agent execution log leaked into the file (broken artifact)`,
      });
      set.status = HTTP_STATUS.UNPROCESSABLE_ENTITY;
      return {
        error:
          `${fileType}.md の内容に実行ログ/ストリーム出力が混入しています（壊れた成果物）。保存を中止しました。` +
          `最終的なMarkdown本文のみ（ツールログ・[System:...]・stream-json を含めない）を保存してください。`,
      };
    }

    // Front-door resurrection guard: after the phase critic rejects an
    // artifact (rollback + archive), the agent that produced it may PUT the
    // same buffered report again — byte-identical — which would resurrect the
    // rejected content and flip the status forward as if the critique never
    // happened (observed on tasks 539/540). Bounce it with the critic's
    // reasons so the agent revises instead of resubmitting.
    {
      const { checkRejectedResave } =
        await import('../../../services/workflow/phase-critic/critic-rejection-guard');
      const resave = await checkRejectedResave(taskId, fileType, content);
      if (resave.isResave) {
        await recordTransition({
          taskId,
          fromStatus: currentStatusForGuard,
          toStatus: currentStatusForGuard,
          actor: 'system',
          cause: 'rejected_resave_blocked',
          phase: fileType,
          metadata: { severity: resave.severity, reasonCount: resave.reasons.length },
          invariantViolation: true,
          invariantMessage: `${fileType}.md rejected: byte-identical resubmission of a critic-rejected artifact`,
        }).catch(() => {});
        set.status = HTTP_STATUS.UNPROCESSABLE_ENTITY;
        return {
          error:
            `${fileType}.md は品質批評ゲートに差し戻された内容と同一のため保存できません。` +
            `以下の指摘を反映して修正した内容を保存してください。`,
          criticReasons: resave.reasons,
          severity: resave.severity,
        };
      }
    }

    // Delegate to writeWorkflowFile so the previous version is archived to
    // WorkflowFileVersion. Mojibake sanitisation runs inside writeWorkflowFile.
    const savedContent = await writeWorkflowFile(taskId, fileType, content);

    // Code-grounded complexity: when research.md is saved, apply the score the
    // research agent embedded and re-select the workflow mode (both directions).
    // The auto-run CLI executor does this too — calling the SAME shared helper
    // here keeps the manual (HTTP) path identical, so a low code-grounded score
    // is not stuck in a metadata-picked 'standard' (the "標準 · 複雑度 18" mismatch).
    if (fileType === 'research') {
      try {
        const { applyResearchAssessedComplexity } =
          await import('../../../services/workflow/research-complexity');
        await applyResearchAssessedComplexity(taskId, savedContent);
      } catch (err) {
        log.warn({ err, taskId }, '[Workflow] Failed to apply research-assessed complexity');
      }
    }

    // Auto-update workflowStatus
    let newStatus: string | undefined;
    const currentStatus = resolved.task.workflowStatus;

    log.info(`[Workflow] Processing fileType: ${fileType}, currentStatus: ${currentStatus}`);

    // Research concluded the requirement is ALREADY satisfied (explicit
    // "修正不要" verdict). Complete the task directly from research — no plan.md,
    // no implementation, no verify — so already-done work doesn't get a
    // duplicate PR. Only valid while still in the research phase.
    // NOTE: hypothesis/decision ledger seeding moved INTO writeWorkflowFile (the
    // universal save choke point) so the auto-run path — which writes via
    // writeWorkflowFile directly, bypassing this API route — also fires it.
    // writeWorkflowFile was already called above to persist savedContent.
    let researchCompleted = false;
    // True when a verify RE-RUN (ci_repair / verify_repair) reported a failure on
    // work that was ALREADY validated + PR'd — a false negative we complete instead
    // of looping. Marks the task done like researchCompleted does.
    let verifyRerunAlreadyDone = false;
    // True when attemptVerifyRepair() already bounced the workflow (and recorded
    // its OWN `verify_repair`-caused transition + task.update). Without this
    // flag the generic `if (newStatus)` block below unconditionally re-runs
    // BOTH the task.update and a SECOND `file_saved:verify` transition for the
    // same save — recorded milliseconds after the real `verify_repair` one.
    // That redundant transition becomes the newest row, so
    // verify-self-repair.hasFreshVerifyRejection() (which only looks at the
    // single most recent transition) no longer sees the bounce as fresh. The
    // CLI executor's completion epilogue then fails to skip, re-validates the
    // same verify.md on its own stale copy, hard-blocks the task, and a
    // downstream watchdog resets it all the way to `draft` — silently
    // discarding the research/plan/implementation work already done (observed
    // live on task 415: verify_repair bounce → redundant file_saved:verify →
    // epilogue hard-block → blocked_auto_retry → reset to draft).
    let verifyRepairBounced = false;
    if (
      fileType === 'research' &&
      (!currentStatus || currentStatus === 'draft' || currentStatus === 'research_done') &&
      researchConcludesNoChange(savedContent)
    ) {
      log.info(`[Workflow] Research concluded no change needed — completing task ${taskId}`);
      newStatus = 'completed';
      researchCompleted = true;
    } else if (fileType === 'research' && (!currentStatus || currentStatus === 'draft')) {
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
          // FALSE-NEGATIVE GUARD: a re-run (ci_repair / verify_repair) executes in
          // a worktree where the work is ALREADY present (committed to the PR branch
          // or merged to base), so the implementer makes NO change and the verifier
          // — seeing an empty diff against a plan that lists "new" files — wrongly
          // reports 実装漏れ ("the artifacts don't exist at all"). If this task has
          // ALREADY reached verify_passed once AND produced a PR, the implementation
          // demonstrably exists, so the failure is a false negative. Complete it
          // instead of looping implement→verify→block forever (observed: task 367,
          // verify_passed→ci_repair→empty-diff re-run→"実装漏れ"→blocked, PR merged).
          const priorVerifyPass = await prisma.workflowTransition
            .findFirst({ where: { taskId, cause: 'verify_passed' }, select: { id: true } })
            .catch(() => null);
          const prRow = priorVerifyPass
            ? await prisma.task
                .findUnique({ where: { id: taskId }, select: { githubPrId: true } })
                .catch(() => null)
            : null;
          if (priorVerifyPass && prRow?.githubPrId != null) {
            log.warn(
              { taskId, prId: prRow.githubPrId, summary: verifyValidation.summary },
              '[Workflow] verify re-run reported a failure, but the task already passed verify and has a PR — completing as already-done (false-negative on already-merged work).',
            );
            newStatus = 'completed';
            verifyRerunAlreadyDone = true;
          } else {
            // Self-repair loop: bounce the workflow back to the implementer with
            // the failure as feedback so the runner re-runs implement → verify,
            // instead of dead-ending at `blocked`. Only block once the bounded
            // repair attempts are exhausted.
            const { attemptVerifyRepair } =
              await import('../../../services/workflow/verify-self-repair');
            const repair = await attemptVerifyRepair(
              taskId,
              currentStatus ?? null,
              verifyValidation.summary,
              savedContent,
            );

            if (repair.bounced && repair.newStatus) {
              log.warn(
                { taskId, attempt: repair.attempt, newStatus: repair.newStatus },
                '[Workflow] verify.md failed validation — re-running implement→verify (self-repair)',
              );
              // Bounce: the runner re-runs the implementer from this status.
              // attemptVerifyRepair() already persisted task.status/workflowStatus
              // and recorded its own `verify_repair` transition — newStatus is set
              // only so the HTTP response reports the real status; the generic
              // save-transition block below must NOT repeat that work.
              newStatus = repair.newStatus;
              verifyRepairBounced = true;
            } else {
              log.warn(
                { taskId, summary: verifyValidation.summary },
                '[Workflow] verify.md failed validation and repairs exhausted — blocking task',
              );
              await prisma.task
                .update({
                  where: { id: taskId },
                  data: { status: 'blocked', updatedAt: new Date() },
                })
                .catch(() => {});
              // Align the execution/session to failed so the log viewer doesn't show
              // 「完了」 while the task is blocked (the status gap).
              await markLatestExecutionFailed(
                taskId,
                `検証に失敗したためブロックしました: ${verifyValidation.summary}`,
              );
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
            }
          }
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

    if (newStatus && !verifyRepairBounced) {
      await prisma.task.update({
        where: { id: taskId },
        // Research-no-change completion (and the verify re-run already-done
        // false-negative guard) also mark the task itself done.
        data:
          researchCompleted || verifyRerunAlreadyDone
            ? {
                workflowStatus: newStatus,
                status: 'done',
                completedAt: new Date(),
                updatedAt: new Date(),
              }
            : { workflowStatus: newStatus, updatedAt: new Date() },
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
        cause: researchCompleted
          ? 'research_no_change_complete'
          : verifyRerunAlreadyDone
            ? 'verify_rerun_already_done'
            : `file_saved:${fileType}`,
        phase: fileType,
        metadata: transitionMetadata,
        invariantViolation: violations.length > 0,
        invariantMessage:
          violations.length > 0
            ? violations.map((v) => `${v.code}:${v.message}`).join(' | ')
            : undefined,
      });
      if (violations.length > 0) {
        const missingFiles = violations
          .filter((v) => v.code === 'missing_file')
          .map((v) => {
            const m = v.message.match(/but (\S+\.md) is missing/);
            return m ? m[1] : 'unknown';
          });
        log.warn(
          {
            taskId,
            violations,
            missingFiles,
            hint:
              missingFiles.length > 0
                ? `save the missing file(s) via PUT /workflow/tasks/${taskId}/files/<type>, or reset status to draft`
                : 'check task.status consistency or open subtasks',
          },
          '[Workflow] Invariant violations detected after status update',
        );
      }
    }

    // Populated below when the critic gate rejects this save — surfaced in the
    // HTTP response so the saving agent's own output (and thus the execution
    // log a user watches) explains the rollback instead of the agent reporting
    // a plain "saved" while the status quietly reverts underneath it.
    let criticRejection: {
      phase: 'research' | 'plan';
      rolledBackTo: string;
      reasons: string[];
      severity?: number;
    } | null = null;

    // Research/plan critic gate (judge panel). After the artifact is saved and
    // its status persisted, run independent critic lenses; on a FAIL verdict the
    // artifact is archived and the workflow rolled back to regenerate it (bounded
    // self-repair, mirroring the verify gate). Changing newStatus to the rollback
    // target naturally skips the auto-split / auto-approve blocks below. Default
    // ON (R7 — plan-defect critique has ~90% recall pre-execution); opt out via
    // RAPITAS_PHASE_CRITIC=0. Lightweight-mode tasks skip it: they have no plan
    // phase, and trivial work must stay cheap. Fail-open when critics are down.
    if (
      resolved.task.workflowMode !== 'lightweight' &&
      ((fileType === 'research' && newStatus === 'research_done') ||
        (fileType === 'plan' && newStatus === 'plan_created'))
    ) {
      const { applyPhaseCriticGate } = await import('../../../services/workflow/phase-critic');
      // NOTE: The critic runs LLM judges SYNCHRONOUSLY inside this request.
      // Unbounded, its wall time (observed 80-150s) exceeds the saving agent's
      // 120s curl timeout: the client resends, races itself, and if the dying
      // request carried the auto-approve tail the task stalls at plan_created
      // forever (task 492). Cap it below the client timeout and fail open —
      // matching this gate's stated fail-open philosophy; the reconciler's
      // healAutoApproveStalls pass is the backstop for anything still lost.
      const criticTimeoutMs = (() => {
        const v = parseInt(process.env.RAPITAS_PHASE_CRITIC_TIMEOUT_MS ?? '', 10);
        return Number.isFinite(v) && v > 0 ? v : 90_000;
      })();
      const gate = await Promise.race([
        applyPhaseCriticGate({
          taskId,
          phase: fileType === 'research' ? 'research' : 'plan',
          content: savedContent,
          currentStatus: newStatus,
        }),
        new Promise<{
          bounced: boolean;
          newStatus?: string;
          reasons?: string[];
          severity?: number;
        }>((resolve) =>
          setTimeout(() => {
            log.warn(
              { taskId, fileType, criticTimeoutMs },
              '[Workflow] Phase critic gate timed out — failing open',
            );
            resolve({ bounced: false });
          }, criticTimeoutMs),
        ),
      ]).catch(
        () =>
          ({ bounced: false }) as {
            bounced: boolean;
            newStatus?: string;
            reasons?: string[];
            severity?: number;
          },
      );
      if (gate.bounced && gate.newStatus) {
        newStatus = gate.newStatus;
        criticRejection = {
          phase: fileType as 'research' | 'plan',
          rolledBackTo: gate.newStatus,
          reasons: gate.reasons ?? [],
          severity: gate.severity,
        };
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
          const researchContent =
            (await readWorkflowFile(taskId, 'research').catch(() => null)) ?? undefined;

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
    // Set when a slow, synchronous check below (adversarial diff review) finishes
    // only after this task has already moved past the verify_done status it was
    // evaluated against — e.g. a second, faster verify/repair round already
    // completed and merged it. Skips any further mutation this request would
    // otherwise make (rollback AND completion), since acting on a stale read
    // here would just corrupt an already-resolved task.
    let staleVerifyRequest = false;

    // Conflict-resolution tasks (system-generated "PR #N の競合を解消", githubPrId
    // set at CREATION) deliver their result by PUSHING to the EXISTING PR branch —
    // not as a worktree diff or a new PR. The empty-diff gate, the adversarial
    // diff-review, the scope check and the PR-required gate all assume "diff
    // matches plan → publish a new PR", so they FALSELY bounce these tasks (the
    // `git merge base` pulls the base branch's files into the worktree → scope NG
    // (31 files) and a diff-vs-plan mismatch → verify_repair, looping forever even
    // though the PR is already mergeable). Skip all those gates and complete on a
    // passing verify; the target PR (task.githubPrId) already exists.
    const conflictTask =
      fileType === 'verify' && newStatus === 'verify_done'
        ? await prisma.task
            .findUnique({ where: { id: taskId }, select: { title: true, githubPrId: true } })
            .catch(() => null)
        : null;
    const isConflictResolutionTask =
      !!conflictTask &&
      conflictTask.githubPrId != null &&
      /^PR #\d+ の競合を解消/.test(conflictTask.title ?? '');

    if (fileType === 'verify' && newStatus === 'verify_done' && !isConflictResolutionTask) {
      const gateSession = await prisma.agentSession
        .findFirst({
          where: { config: { taskId }, worktreePath: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { worktreePath: true },
        })
        .catch(() => null);
      // The worktree's ACTUAL fork point, not a guess — see automated-verifier
      // .ts's diffBaseRef doc comment (task 506). NOTE: theme.defaultBranch,
      // not AgentExecutionConfig.targetBranch alone (task 511: that table is
      // empty for the autonomous pipeline) — see resolvePreferredBaseBranch's
      // doc comment. This call site was missed when the other five were fixed.
      const preferredBaseBranchForCompletion = await resolvePreferredBaseBranch(taskId);
      const completionGate = await evaluateCompletionGate(
        gateSession?.worktreePath ?? null,
        savedContent,
        preferredBaseBranchForCompletion,
      );
      if (!completionGate.allow) {
        verifyGateBlocked = true;
        // Empty diff + no explicit "no change needed" justification. The FIRST
        // time, block so a re-run can implement (or add the justification). But if
        // the task has ALREADY hit verify_no_changes before, the implementer was
        // given a chance and STILL produced no diff — the code is genuinely
        // already correct / no change is needed. Per product requirement, complete
        // it as 修正不要 and move on instead of leaving it stuck blocked forever.
        const priorNoChange = await prisma.workflowTransition
          .count({ where: { taskId, cause: 'verify_no_changes' } })
          .catch(() => 0);

        if (priorNoChange >= 1) {
          await prisma.task
            .update({
              where: { id: taskId },
              data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
            })
            .catch(() => {});
          await recordTransition({
            taskId,
            fromStatus: 'verify_done',
            toStatus: 'completed',
            actor: 'system',
            cause: 'verify_no_change_confirmed',
            phase: 'verify',
            metadata: { reason: completionGate.reason, priorNoChange },
          });
          log.info(
            { taskId, priorNoChange },
            '[Workflow] Empty diff confirmed across attempts — completing as no-change-needed (修正不要), moving on.',
          );
        } else {
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
            '[Workflow] verify passed but no code changes and no justification — blocking (1st time; re-run may implement or justify)',
          );
        }
      }
    }

    // Independent adversarial diff review: a cross-provider JURY (majority
    // vote, tie→fail) scores the ACTUAL diff against plan + acceptance
    // criteria, catching wrong/incomplete implementations that the
    // self-reported verify.md misses. On a FAIL verdict, bounce the workflow
    // back to the implementer (self-repair loop). Availability is risk-gated
    // inside the diff-review gate: low-risk 'unknown' fails open; high-risk changes
    // fail closed when no juror is reachable.
    if (
      fileType === 'verify' &&
      newStatus === 'verify_done' &&
      !verifyGateBlocked &&
      !isConflictResolutionTask
    ) {
      const reviewSession = await prisma.agentSession
        .findFirst({
          where: { config: { taskId }, worktreePath: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { worktreePath: true },
        })
        .catch(() => null);
      const { reviewDiffAdversarially } =
        await import('../../../services/agents/verification/adversarial-diff-review');
      const review = await reviewDiffAdversarially({
        taskId,
        worktreePath: reviewSession?.worktreePath,
      }).catch(() => null);

      if (review && review.verdict === 'fail') {
        const reason = `差分レビュー不合格: ${
          review.reasons.slice(0, 5).join(' / ') || '受入基準を満たしていません'
        }`;
        const { attemptVerifyRepair } =
          await import('../../../services/workflow/verify-self-repair');
        const repair = await attemptVerifyRepair(taskId, 'verify_done', reason, savedContent).catch(
          () => ({ bounced: false }) as Awaited<ReturnType<typeof attemptVerifyRepair>>,
        );
        // Compare-and-swap: this review runs an LLM jury synchronously and can
        // take a while — a second, faster verify attempt (self-repair round, or
        // a race) can legitimately complete and even merge the task before this
        // verdict comes back. Applying it unconditionally would then stomp an
        // already-completed/merged task back to plan_approved (observed: task
        // 503 was rolled back ~40s after its PR had already merged). Skip the
        // entire rollback — including verifyGateBlocked and the transition log —
        // when the task has already moved off the status this review evaluated.
        const liveTask = await prisma.task
          .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
          .catch(() => null);
        if (liveTask?.workflowStatus !== 'verify_done') {
          staleVerifyRequest = true;
          // Report what the task ACTUALLY is now (e.g. 'completed'), not the
          // 'verify_done' this stale evaluation was based on — the response
          // reaches the saving agent, and it must not be told a status that
          // isn't true in the DB.
          if (liveTask?.workflowStatus) newStatus = liveTask.workflowStatus;
          log.warn(
            { taskId, severity: review.severity, actualStatus: liveTask?.workflowStatus },
            '[Workflow] Adversarial review FAIL arrived after the workflow moved on — skipping rollback entirely',
          );
        } else {
          verifyGateBlocked = true;
          if (repair.bounced && repair.newStatus) {
            const rolled = await prisma.task
              .updateMany({
                where: { id: taskId, workflowStatus: 'verify_done' },
                data: { workflowStatus: repair.newStatus },
              })
              .catch(() => ({ count: 0 }));
            if (rolled.count === 0) {
              log.warn(
                { taskId, attempt: repair.attempt, severity: review.severity },
                '[Workflow] Adversarial review FAIL lost the compare-and-swap race — skipping rollback',
              );
            } else {
              newStatus = repair.newStatus;
              // Bounced ≠ this execution succeeded: the diff it produced was
              // rejected, even though the workflow itself lives on for a retry
              // (a fresh AgentExecution row is created for that). Without this,
              // markLatestExecutionFailed only ran once repairs were exhausted,
              // so a bounced-for-retry run kept showing 完了/success in the
              // execution log while the task had just been rolled back.
              await markLatestExecutionFailed(taskId, reason);
              log.warn(
                { taskId, attempt: repair.attempt, severity: review.severity },
                '[Workflow] Adversarial diff review FAILED — bounced to implementer for self-repair',
              );
            }
          } else {
            // NOTE: this update was previously missing — the log claimed "task
            // stays blocked" but task.status was never actually set, leaving
            // the task looking untouched (status stuck at whatever it already
            // was, e.g. 'todo') instead of clearly flagged for attention
            // (task 504: workflowStatus stayed 'verify_done' with no PR/commit
            // and status='todo', indistinguishable from a never-started task).
            await prisma.task
              .update({ where: { id: taskId }, data: { status: 'blocked', updatedAt: new Date() } })
              .catch(() => {});
            await markLatestExecutionFailed(taskId, reason);
            log.warn(
              { taskId, severity: review.severity },
              '[Workflow] Adversarial diff review FAILED and repairs exhausted — task stays blocked',
            );
          }
          await recordTransition({
            taskId,
            fromStatus: 'verify_done',
            toStatus: newStatus,
            actor: 'system',
            cause: 'adversarial_review_failed',
            phase: 'verify',
            metadata: { severity: review.severity, reasons: review.reasons.slice(0, 5) },
            invariantViolation: true,
            invariantMessage: reason,
          }).catch(() => {});
        }
      }
    }

    let autoCommitPRResult: Awaited<ReturnType<typeof performAutoCommitAndPR>> = {};
    let taskMarkedDone = false;
    if (
      fileType === 'verify' &&
      newStatus === 'verify_done' &&
      !verifyGateBlocked &&
      !staleVerifyRequest &&
      isConflictResolutionTask
    ) {
      // Conflict-resolution task: the fix was already pushed to the existing PR
      // branch, so there is no new commit/PR to make and the scope check does not
      // apply. Complete directly — the PR (task.githubPrId) is what carries the work.
      await prisma.task
        .update({
          where: { id: taskId },
          data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
        })
        .catch(() => {});
      taskMarkedDone = true;
      await recordTransition({
        taskId,
        fromStatus: 'verify_done',
        toStatus: 'completed',
        actor: 'system',
        cause: 'conflict_resolution_completed',
        phase: 'verify',
        metadata: { prNumber: conflictTask?.githubPrId },
      });
      log.info(
        { taskId, prNumber: conflictTask?.githubPrId },
        '[Workflow] Conflict-resolution task completed (work pushed to PR branch; commit/PR/scope gates skipped).',
      );
    } else if (
      fileType === 'verify' &&
      newStatus === 'verify_done' &&
      !verifyGateBlocked &&
      !staleVerifyRequest
    ) {
      // Run commit/PR/merge. Completion is GATED on its outcome: the task only
      // completes when a PR was created (or already exists), or when no PR was
      // requested. See the gate in the success branch below.
      autoCommitPRResult = await performAutoCommitAndPR(taskId, savedContent).catch((err) => {
        log.warn({ err, taskId }, '[Workflow] Auto-commit/PR threw');
        return {} as Awaited<ReturnType<typeof performAutoCommitAndPR>>;
      });
      const commit = autoCommitPRResult.autoCommitResult;
      const pr = autoCommitPRResult.autoPRResult;
      const merge = autoCommitPRResult.autoMergeResult;

      if (autoCommitPRResult.verificationBlocked) {
        // The automated gate (lint / typecheck / test / scope) found problems in
        // the agent's changes, so commit/PR were withheld. Rather than dead-end
        // at `blocked`, bounce back to the implementer with the failure as
        // feedback so it FIXES the issue and re-verifies (self-improvement loop,
        // bounded by RAPITAS_MAX_VERIFY_REPAIRS). Block only once exhausted.
        verifyGateBlocked = true; // either way, do not mark done/PR this pass
        const gateReason =
          autoCommitPRResult.error ?? '自動検証に失敗しました（lint/型/テスト/スコープ）。';
        const { attemptVerifyRepair } =
          await import('../../../services/workflow/verify-self-repair');
        const repair = await attemptVerifyRepair(
          taskId,
          'verify_done',
          gateReason,
          savedContent,
        ).catch(() => ({ bounced: false }) as Awaited<ReturnType<typeof attemptVerifyRepair>>);

        if (repair.bounced && repair.newStatus) {
          // Compare-and-swap: performAutoCommitAndPR ran real git/lint/test
          // subprocesses above and can take a while — if a concurrent request
          // for this same task (e.g. a duplicate/retried save) already moved
          // the task past verify_done in the meantime, an unconditional update
          // here would stomp that newer state back to the implementer entry.
          // Mirrors the same guard on the adversarial-review bounce above.
          const rolled = await prisma.task
            .updateMany({
              where: { id: taskId, workflowStatus: 'verify_done' },
              data: { workflowStatus: repair.newStatus },
            })
            .catch(() => ({ count: 0 }));
          if (rolled.count === 0) {
            log.warn(
              { taskId, attempt: repair.attempt, reason: gateReason },
              '[Workflow] Verification gate failed but the workflow already moved on — skipping rollback',
            );
          } else {
            newStatus = repair.newStatus;
            log.warn(
              { taskId, attempt: repair.attempt, reason: gateReason },
              '[Workflow] Verification gate failed — bounced to implementer for self-repair',
            );
          }
        } else {
          await markLatestExecutionFailed(taskId, gateReason);
          log.warn(
            { taskId, reason: gateReason },
            '[Workflow] Verification gate failed and self-repairs exhausted — task stays blocked, no commit/PR.',
          );
        }
      } else {
        // Completion REQUIRES a successfully created PR (user request): a passing
        // verify is no longer enough — the change must reach a PR. Exceptions:
        //   - PR creation was not requested (autoCreatePR off), or
        //   - a PR already exists for this task (app-linked or task.githubPrId).
        const prRequested = autoCommitPRResult.requested
          ? autoCommitPRResult.requested.autoCreatePR
          : true; // requested unset (e.g. threw) → default flow expects a PR
        let prSatisfied = pr?.success === true;
        if (prRequested && !prSatisfied) {
          const linked = await prisma.gitHubPullRequest
            .findFirst({ where: { linkedTaskId: taskId }, select: { id: true } })
            .catch(() => null);
          if (linked) {
            prSatisfied = true;
          } else {
            const taskRow = await prisma.task
              .findUnique({ where: { id: taskId }, select: { githubPrId: true } })
              .catch(() => null);
            prSatisfied = taskRow?.githubPrId != null;
          }
        }

        // No-diff / already-implemented: verify passed but there is NOTHING to PR
        // because the code already satisfies the task. Requiring a PR here
        // wrongly blocks an already-done task — complete it as a no-change
        // result instead (mirrors the research "## 結論: 修正不要" path). The
        // shared classifier excludes base-branch errors and real committed
        // changes (task 485: nonexistent base also says "No commits between").
        const noChangeCompletion =
          prRequested &&
          !prSatisfied &&
          isNoChangeCompletion({
            errorBlob: `${pr?.error ?? ''} ${commit?.error ?? ''} ${autoCommitPRResult.error ?? ''}`,
            filesChanged: commit?.filesChanged,
          });

        if (noChangeCompletion) {
          await prisma.task
            .update({
              where: { id: taskId },
              data: {
                status: 'done',
                workflowStatus: 'completed',
                completedAt: new Date(),
                updatedAt: new Date(),
              },
            })
            .catch(() => {});
          taskMarkedDone = true;
          newStatus = 'completed';
          await recordTransition({
            taskId,
            fromStatus: 'verify_done',
            toStatus: 'completed',
            actor: 'system',
            cause: 'verify_no_change_confirmed',
            phase: 'verify',
            metadata: {
              reason: 'no diff — already implemented; PR not required',
              prError: pr?.error,
              commitError: commit?.error,
            },
          });
          log.info(
            { taskId, prError: pr?.error },
            '[Workflow] verify passed with NO diff (already implemented) — completing WITHOUT a PR.',
          );
        } else if (prRequested && !prSatisfied) {
          // Verify passed but no PR was produced — do NOT complete. Keep the task
          // actionable (blocked) and surface why, so "完了" always implies a PR.
          const reason =
            pr?.error || commit?.error || autoCommitPRResult.error || 'PRが作成されませんでした';
          await prisma.task
            .update({ where: { id: taskId }, data: { status: 'blocked', updatedAt: new Date() } })
            .catch(() => {});
          await markLatestExecutionFailed(
            taskId,
            `検証は通過しましたがPRが作成されませんでした: ${reason}。完了にはPR作成が必要です。`,
          );
          await recordTransition({
            taskId,
            fromStatus: 'verify_done',
            toStatus: 'verify_done',
            actor: 'system',
            cause: 'verify_pr_not_created',
            phase: 'verify',
            metadata: {
              commit: commit?.success,
              prError: pr?.error,
              error: autoCommitPRResult.error,
            },
            invariantViolation: true,
            invariantMessage:
              '検証通過後にPRが作成されませんでした。PR作成成功まで完了にしません。',
          });
          log.warn(
            {
              taskId,
              prError: pr?.error,
              commitOk: commit?.success,
              error: autoCommitPRResult.error,
            },
            '[Workflow] verify passed but no PR created — NOT completing (completion requires a PR).',
          );
        } else {
          // Staged completion: when changes land via a PR, completion is NOT at
          // PR creation — `pr` mode completes when the PR's CI goes green, `merge`
          // mode completes when the PR is merged. The PR-completion watcher
          // advances those. Only `commit`/`none` complete here. Gated OFF by
          // default so existing deployments keep the verify-time completion until
          // they opt in (RAPITAS_STAGED_COMPLETION=true) + restart.
          const staged =
            process.env.RAPITAS_STAGED_COMPLETION === 'true' ||
            process.env.RAPITAS_STAGED_COMPLETION === '1';
          const landingMode = autoCommitPRResult.requested
            ? resolveLandingMode(autoCommitPRResult.requested)
            : 'none';
          if (staged && (landingMode === 'pr' || landingMode === 'merge')) {
            // Hold at verify_done (status stays in-progress, NOT done). The watcher
            // completes on CI-green (pr) / merge (merge). Do not fire completion
            // side effects yet (taskMarkedDone stays false).
            await recordTransition({
              taskId,
              fromStatus: 'verify_done',
              toStatus: 'verify_done',
              actor: 'system',
              cause: 'verify_passed_awaiting_ci',
              phase: 'verify',
              metadata: { landingMode, pr: pr?.success, prNumber: pr?.prNumber },
            });
            log.info(
              { taskId, landingMode, prNumber: pr?.prNumber },
              '[Workflow] verify passed + PR created — completion deferred to CI/merge (staged completion).',
            );
          } else {
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
              '[Workflow] verify.md passed AND PR satisfied — task marked done/completed.',
            );
          }
        }
      }

      // Post-completion side effects only when the task ACTUALLY completed (not
      // when it was bounced for self-repair or held for a missing PR).
      if (taskMarkedDone) {
        // Record the outcome for telemetry + adaptive routing (fire-and-forget).
        import('../../../services/workflow/outcome-telemetry')
          .then(({ recordTaskOutcome }) => recordTaskOutcome(taskId, 'completed'))
          .catch(() => {});

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
    }

    // Telemetry: a verify save that left the task BLOCKED by any gate (NOT a
    // self-repair bounce — those leave it in-progress for a re-run) is recorded
    // as a blocked outcome, so the per-theme difficulty signal reflects failures
    // as well as successes.
    if (fileType === 'verify' && !taskMarkedDone) {
      const cur = await prisma.task
        .findUnique({ where: { id: taskId }, select: { status: true } })
        .catch(() => null);
      if (cur?.status === 'blocked') {
        import('../../../services/workflow/outcome-telemetry')
          .then(({ recordTaskOutcome }) => recordTaskOutcome(taskId, 'blocked'))
          .catch(() => {});
      }
    }

    // Build response
    const response: Record<string, unknown> = {
      success: true,
      fileType,
      workflowStatus: newStatus || currentStatus,
      autoApproved,
    };

    if (splitResult) {
      response.subtaskSplit = splitResult;
    }

    if (criticRejection) {
      // Deliberately verbose and unambiguous: the saving agent reads this
      // response directly, and its own narration of it is what the user sees
      // in the execution log. A terse flag risks being paraphrased away as
      // "saved successfully" — spell out that this is expected self-repair
      // behavior, not a failure or a bug, so the agent reports it as such.
      response.criticGateRejected = true;
      response.message =
        `${criticRejection.phase}.md の内容は保存されましたが、自動品質レビュー（批評ゲート）が不合格と判定したためアーカイブされ、` +
        `workflowStatus は ${criticRejection.rolledBackTo} に巻き戻されました。これはバグではなく、内容を改善して再生成するための想定内の自己修復動作です。` +
        `再開後は次の指摘事項に対応した内容で ${criticRejection.phase}.md を再保存してください。`;
      response.criticReasons = criticRejection.reasons;
      if (criticRejection.severity !== undefined)
        response.criticSeverity = criticRejection.severity;
      log.info(
        {
          taskId,
          phase: criticRejection.phase,
          rolledBackTo: criticRejection.rolledBackTo,
          severity: criticRejection.severity,
          reasons: criticRejection.reasons,
        },
        '[Workflow] Save response includes critic-gate rejection details for the saving agent',
      );
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
