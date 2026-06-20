/**
 * verify-self-repair
 *
 * When the verify.md validator rejects a verifier's output (self-contradiction:
 * claims pass but body shows failures, or an explicit ❌ verdict), instead of
 * dead-ending the task at `blocked` this bounces the workflow BACK to the
 * implementer phase with the failure as feedback, so the runner re-runs
 * implement → verify automatically. Bounded by a per-task attempt cap (counted
 * from WorkflowTransition rows — no schema change); once exhausted the caller
 * blocks as before. Not responsible for spawning agents — the status-driven
 * WorkflowRunner picks up the re-implement phase on its next poll.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { resolveWorkflowDir, readWorkflowFile, writeWorkflowFile } from './workflow-file-utils';
import { recordTransition } from './transition-recorder';

const log = createLogger('workflow:verify-self-repair');

/** WorkflowTransition.cause used to count + identify repair bounces. */
const REPAIR_CAUSE = 'verify_repair';

/** Default max verify→implement repair cycles before giving up and blocking. */
const DEFAULT_MAX_VERIFY_REPAIRS = Math.max(
  0,
  parseInt(process.env.RAPITAS_MAX_VERIFY_REPAIRS ?? '2', 10) || 2,
);

export interface VerifyRepairResult {
  /** True when the workflow was bounced back to implement (caller must NOT block). */
  bounced: boolean;
  /** The workflowStatus to set so the implementer re-runs (when bounced). */
  newStatus?: string;
  /** 1-based attempt number for this bounce. */
  attempt?: number;
}

/**
 * Count how many verify→implement repair bounces this task has already had.
 *
 * @param taskId - Task id / タスクID
 * @returns Prior repair count / これまでの修復回数
 */
async function countPriorRepairs(taskId: number): Promise<number> {
  return prisma.workflowTransition.count({ where: { taskId, cause: REPAIR_CAUSE } }).catch(() => 0);
}

/**
 * Resolve the implementer's ENTRY status for a task: `plan_approved` when a
 * plan.md exists (standard/comprehensive), else `research_done` (lightweight) —
 * matching buildTransitions(). Setting workflowStatus to this makes the runner
 * re-run implement → verify.
 *
 * @param taskId - Task id / タスクID
 * @returns The status to bounce to / 戻す先のstatus
 */
async function resolveImplementEntryStatus(
  taskId: number,
): Promise<'plan_approved' | 'research_done'> {
  const plan = await prisma.workflowFile
    .findFirst({ where: { taskId, fileType: 'plan' }, select: { id: true } })
    .catch(() => null);
  return plan ? 'plan_approved' : 'research_done';
}

/**
 * Write the verify failure back to question.md so the re-run implementer reads
 * it as feedback (the implementer context surfaces question.md). Preserves any
 * existing content by appending a clearly-marked section. Best-effort.
 *
 * @param taskId - Task id / タスクID
 * @param reason - Validator summary / バリデータの要約
 * @param verifyContent - The rejected verify.md (for the agent's reference) / 却下されたverify.md
 * @param attempt - 1-based attempt number / 試行回数
 */
async function writeRepairFeedback(
  taskId: number,
  reason: string,
  verifyContent: string,
  attempt: number,
): Promise<void> {
  try {
    const info = await resolveWorkflowDir(taskId);
    if (!info) return;
    // Verification feedback belongs to the verify artifact, not question.md
    // (Q&A). The implementer context reads verify.md for this on re-run.
    const prior = (await readWorkflowFile(info.dir, 'verify')) ?? '';
    const block = [
      `# 検証フェーズからの差し戻し（自己修復 ${attempt} 回目）`,
      '',
      `直前の検証 (verify.md) が不合格でした: ${reason}`,
      '',
      '以下を厳守して **実装を修正** してください:',
      '- verify.md に出ている失敗（失敗テスト・型/lint エラー・未達の受け入れ基準）を実際に解消する。',
      '- 「成功した」と書くだけ・テスト結果を偽るのは禁止。テストを実際に通すこと。',
      '- スコープ厳守（plan.md 記載外のファイルは変更しない）。',
      '',
      '## 参考: 不合格となった verify.md の冒頭',
      '```md',
      verifyContent.slice(0, 1500),
      '```',
    ].join('\n');
    const next = prior.trim() ? `${prior.trim()}\n\n---\n\n${block}` : block;
    await writeWorkflowFile(info.dir, 'verify', next, taskId);
  } catch (err) {
    log.warn({ err, taskId }, '[verify-repair] Failed to write repair feedback to verify.md');
  }
}

/**
 * Attempt a verify→implement self-repair bounce. Returns `bounced:false` (caller
 * should block) once the per-task attempt cap is reached, or when repairs are
 * disabled (RAPITAS_MAX_VERIFY_REPAIRS=0).
 *
 * @param taskId - Task being verified / 検証対象タスク
 * @param currentStatus - The workflowStatus at the time verify.md was saved / 現在のstatus
 * @param reason - Validator failure summary / 失敗要約
 * @param verifyContent - The rejected verify.md body / 却下されたverify.md
 * @returns Whether the workflow was bounced and to which status / 戻したか・戻し先
 */
export async function attemptVerifyRepair(
  taskId: number,
  currentStatus: string | null,
  reason: string,
  verifyContent: string,
): Promise<VerifyRepairResult> {
  if (DEFAULT_MAX_VERIFY_REPAIRS === 0) return { bounced: false };

  const prior = await countPriorRepairs(taskId);
  if (prior >= DEFAULT_MAX_VERIFY_REPAIRS) {
    log.warn(
      { taskId, prior, max: DEFAULT_MAX_VERIFY_REPAIRS },
      '[verify-repair] Repair attempts exhausted — caller should block',
    );
    return { bounced: false };
  }

  const attempt = prior + 1;
  const newStatus = await resolveImplementEntryStatus(taskId);

  await writeRepairFeedback(taskId, reason, verifyContent, attempt);

  // Keep the task non-terminal and roll the workflow back to the implementer
  // entry so the runner re-runs implement → verify (rather than treating it as
  // failed/blocked).
  await prisma.task
    .update({
      where: { id: taskId },
      data: { status: 'in-progress', workflowStatus: newStatus, updatedAt: new Date() },
    })
    .catch((err) =>
      log.warn({ err, taskId }, '[verify-repair] Failed to reset task to in-progress'),
    );

  await recordTransition({
    taskId,
    fromStatus: currentStatus ?? null,
    toStatus: newStatus,
    actor: 'system',
    cause: REPAIR_CAUSE,
    phase: 'verify',
    metadata: { attempt, max: DEFAULT_MAX_VERIFY_REPAIRS, reason },
  });

  // Self-drive the re-run. The WorkflowRunner only polls while an AIOrchestra
  // session or theme-auto-run is active; a single/manual execution has no poller,
  // so a bounce would otherwise park the task at in-progress forever (the very
  // stuck-state this loop is meant to avoid). Re-queue + idempotently start the
  // runner so implement → verify actually re-runs regardless of launch mode.
  await ensureRunnerResumes(taskId).catch((err) =>
    log.warn({ err, taskId }, '[verify-repair] Failed to re-queue for self-repair'),
  );

  log.info(
    { taskId, attempt, max: DEFAULT_MAX_VERIFY_REPAIRS, newStatus },
    '[verify-repair] Bounced verify failure back to implementer',
  );
  return { bounced: true, newStatus, attempt };
}

/**
 * Re-queue the task and ensure the WorkflowRunner is processing, so the
 * implement→verify re-run happens for a SINGLE/MANUAL execution that has no
 * poller driving it.
 *
 * Skips entirely when the task's theme has ACTIVE auto-run: that scheduler
 * already re-enqueues its current task (with its themeId, so the global
 * concurrency gate counts it) and starts the runner. Enqueuing here too would
 * add a themeId-LESS item the gate can't see — letting the scheduler launch a
 * second task concurrently (the "multiple agents started before others
 * finished" bug). Idempotent: enqueue throws when an active item already exists
 * — swallowed. The per-task single-agent mutex prevents a duplicate agent.
 *
 * @param taskId - Task to resume / 再開対象タスク
 */
async function ensureRunnerResumes(taskId: number): Promise<void> {
  // Defer to the theme auto-run scheduler when it owns this task.
  try {
    const task = await prisma.task
      .findUnique({ where: { id: taskId }, select: { themeId: true } })
      .catch(() => null);
    const { isThemeAutoRunActive } = await import('./auto-run/theme-auto-run-service');
    if (await isThemeAutoRunActive(task?.themeId ?? null)) {
      log.info(
        { taskId, themeId: task?.themeId },
        '[verify-repair] Theme auto-run is active — letting the scheduler resume (no extra enqueue)',
      );
      return;
    }
  } catch (err) {
    // If we cannot determine auto-run state, fall through and self-drive — a
    // stuck single-exec task is worse than a redundant (deduped) enqueue.
    log.warn({ err, taskId }, '[verify-repair] Could not check theme auto-run state');
  }

  const { WorkflowQueueService } = await import('./workflow-queue');
  const { WorkflowRunner } = await import('./workflow-runner');
  try {
    await WorkflowQueueService.getInstance().enqueue({ taskId });
  } catch {
    // Already queued/running — a driver is active; nothing to enqueue.
  }
  WorkflowRunner.getInstance().startProcessing(); // idempotent (guarded by `running`)
}
