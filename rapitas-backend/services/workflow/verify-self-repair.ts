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
import { readWorkflowFile, writeWorkflowFile } from './workflow-file-utils';
import { recordTransition } from './transition-recorder';
import {
  parseAcceptanceCriteria,
  detectNonConvergence,
  identifyIndictedCriteria,
  type ConvergenceVerdict,
} from './verify-convergence';
import { VERIFY_NON_CONVERGENCE_CAUSE } from './blocked-task-policy';

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
  /**
   * True when the bounce was skipped because the workflow already moved past
   * the evaluated status (stale verdict — e.g. a re-verify passed meanwhile).
   * Callers must treat this as "do nothing": neither bounce NOR block.
   */
  stale?: boolean;
  /** True when the non-convergence cutoff already recorded its own transition — callers must skip their own recordTransition call (not the block side effects). */
  cutoff?: boolean;
}

/**
 * Resolve the max verify->implement repair cycles: UserSettings.verifyRepairLimit
 * when set (UI-configurable), else the env/default. Read via cast — the column is
 * pending Prisma client regen until the next restart.
 *
 * @returns Max repair cycles / 最大修復サイクル数
 */
async function resolveMaxRepairs(): Promise<number> {
  const s = (await prisma.userSettings.findFirst().catch(() => null)) as {
    verifyRepairLimit?: number | null;
  } | null;
  const v = s?.verifyRepairLimit;
  return typeof v === 'number' && v >= 0 ? v : DEFAULT_MAX_VERIFY_REPAIRS;
}

/**
 * Start of the current repair window: the most recent point at which the slate
 * was wiped.
 *
 * Two things wipe it. A manual retry, obviously. And REPLACING the acceptance
 * criteria — reasons recorded against the old ones cite criteria by NUMBER, and
 * after a replacement those numbers point at different criteria, so neither the
 * budget nor the convergence check may carry them forward. Task 672 had its
 * criteria corrected mid-flight and the next single bounce tripped the cutoff
 * on two pre-correction reasons.
 *
 * @param taskId - Task id / タスクID
 * @returns Window start, or null when the slate was never wiped. / 窓の起点、無ければ null
 */
async function resolveRepairWindowStart(taskId: number): Promise<Date | null> {
  const row = await prisma.activityLog
    .findFirst({
      where: { taskId, action: { in: ['task_retried', 'acceptance_criteria_changed'] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    .catch(() => null);
  return row?.createdAt ?? null;
}

/**
 * Count how many verify→implement repair bounces this task has already had.
 * @param taskId - Task id / タスクID
 * @returns Prior repair count / これまでの修復回数
 */
async function countPriorRepairs(taskId: number): Promise<number> {
  // Reset the budget on each manual retry: count only repair bounces SINCE the
  // most recent `task_retried` (recorded by POST /tasks/:id/retry). Without this,
  // a retried blocked task whose worktree was cleaned re-runs verify on an empty
  // tree, fails, and — finding the OLD budget already exhausted — re-blocks
  // instead of bouncing to the implementer, so the implementation is never redone.
  const windowStart = await resolveRepairWindowStart(taskId);
  return prisma.workflowTransition
    .count({
      where: {
        taskId,
        cause: REPAIR_CAUSE,
        ...(windowStart ? { createdAt: { gt: windowStart } } : {}),
      },
    })
    .catch((err) => {
      // FAIL CLOSED: a count error must NOT read as "0 prior repairs" — that
      // would let the caller (prior >= max) keep bouncing indefinitely because
      // every failed count resets the apparent budget to zero. Returning
      // MAX_SAFE_INTEGER makes `prior >= max` true for any configured max, so
      // the caller blocks instead of looping when the budget can't be verified.
      log.warn(
        { err, taskId },
        '[verify-repair] Failed to count prior repairs — treating budget as exhausted',
      );
      return Number.MAX_SAFE_INTEGER;
    });
}

/**
 * Detect a non-converging repair loop (task 619): map current + prior repair
 * reasons (same window as countPriorRepairs — see resolveRepairWindowStart) onto the acceptance
 * criteria; 2+ flags on one criterion = cutoff. FAIL OPEN throughout — unlike
 * countPriorRepairs' fail-closed budget, an unidentifiable reason / missing
 * criteria / DB error must NOT stop a possibly-progressing task.
 *
 * @param taskId - Task id / タスクID
 * @param currentReason - The reason about to trigger this bounce / 今回の差し戻し理由
 * @returns Cutoff verdict / 収束判定
 */
async function detectRepairNonConvergence(
  taskId: number,
  currentReason: string,
): Promise<ConvergenceVerdict> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { acceptanceCriteria: true },
    });
    const criteria = parseAcceptanceCriteria(task?.acceptanceCriteria ?? null);
    // Short-circuit BEFORE any transition query: no criteria → nothing to match.
    if (criteria.length === 0) return { cutoff: false };

    // A manual retry grants a fresh slate — and so does REPLACING the acceptance
    // criteria. Reasons recorded against the old criteria cite them by number,
    // and after a replacement those numbers point at different criteria: task
    // 672 had its criteria corrected mid-flight and the next single bounce
    // tripped the cutoff on two pre-correction reasons. Whichever boundary is
    // more recent wins.
    const boundary = await prisma.activityLog
      .findFirst({
        where: { taskId, action: { in: ['task_retried', 'acceptance_criteria_changed'] } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      .catch(() => null);
    const rows = await prisma.workflowTransition.findMany({
      where: {
        taskId,
        cause: REPAIR_CAUSE,
        ...(boundary ? { createdAt: { gt: boundary.createdAt } } : {}),
      },
      select: { metadata: true },
    });

    const priorReasons: string[] = [];
    for (const row of rows as { metadata: string | null }[]) {
      // Malformed metadata rows are skipped (retro-evidence pattern), never thrown.
      try {
        const meta = JSON.parse(row.metadata ?? '{}') as { reason?: unknown };
        if (typeof meta.reason === 'string' && meta.reason) priorReasons.push(meta.reason);
      } catch {}
    }
    const verdict = detectNonConvergence(currentReason, priorReasons, criteria);

    // Make the fail-open audible. The detector stays silent both when a task IS
    // converging and when it simply cannot read the criteria — task 666 spent
    // ten bounces in the second state with nothing to show for it, because a
    // no-cutoff verdict looks identical either way. A window this deep where
    // NOTHING was ever identified is the signature of a detector that is not
    // working, not of a task making progress.
    if (!verdict.cutoff && priorReasons.length >= 2) {
      const everIdentified = [...priorReasons, currentReason].some(
        (r) => identifyIndictedCriteria(r, criteria).length > 0,
      );
      if (!everIdentified) {
        log.warn(
          { taskId, bounces: priorReasons.length + 1, criteria: criteria.length },
          '[verify-repair] Non-convergence detector matched NOTHING across the whole repair window — the cutoff cannot fire for this task',
        );
      }
    }
    return verdict;
  } catch (err) {
    log.warn(
      { err, taskId },
      '[verify-repair] Non-convergence check failed — failing open (no cutoff)',
    );
    return { cutoff: false };
  }
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
export async function resolveImplementEntryStatus(
  taskId: number,
): Promise<'plan_approved' | 'research_done'> {
  const plan = await prisma.workflowFile
    .findFirst({ where: { taskId, fileType: 'plan' }, select: { id: true } })
    .catch(() => null);
  return plan ? 'plan_approved' : 'research_done';
}

/** Markers delimiting the appended feedback so the validator can skip it. */
export const REPAIR_FEEDBACK_START = '<!-- repair-feedback:start -->';
export const REPAIR_FEEDBACK_END = '<!-- repair-feedback:end -->';

/** Matches a whole marker-delimited repair-feedback block (for replace/strip). */
const REPAIR_FEEDBACK_BLOCK_RE =
  /<!--\s*repair-feedback:start\s*-->[\s\S]*?<!--\s*repair-feedback:end\s*-->/gi;

/**
 * Sanitize numeric failure tallies out of a validator reason before it is
 * appended to verify.md. The raw reason quotes failure evidence like
 * "(1 failed | Tests 3 failed)"; the next validateVerify pass would re-detect
 * those counts and make the self-contradiction PERMANENT (task 494's loop).
 *
 * @param reason - Raw validator summary. / バリデータの生の要約
 * @returns Reason with count phrases replaced by a neutral marker. / 数値集計を除去した要約
 */
export function sanitizeRepairReason(reason: string): string {
  return (
    reason
      // ja count phrases first (they may embed digits the en pattern misses)
      .replace(/失敗\s*(?:した)?テスト\s*(?:数|件数)?\s*[:：]?\s*\d+/g, 'テスト失敗あり')
      .replace(/テスト[^。\n]{0,20}?\d+\s*(?:件|個)\s*(?:が)?\s*失敗/g, 'テスト失敗あり')
      .replace(
        /(?:❌|失敗|不合格|不適合|fail(?:ed|ure)?)\s*[:：]?\s*[×x]\s*\d+/gi,
        'テスト失敗あり',
      )
      .replace(/(?:tests?\s+)?\d+\s+failed/gi, 'テスト失敗あり')
  );
}

/**
 * Build the marker-wrapped feedback block appended to verify.md. One short
 * paragraph — never the full rejected file nor a long quote, both of which
 * re-fed the failure counts into the next validation cycle.
 *
 * @param reason - Validator summary (will be sanitized). / バリデータ要約（内部で無害化）
 * @param attempt - 1-based repair attempt. / 試行回数
 * @returns The block including start/end markers. / マーカー付きブロック
 */
export function buildRepairFeedbackBlock(reason: string, attempt: number): string {
  return [
    REPAIR_FEEDBACK_START,
    `# 検証フェーズからの差し戻し（自己修復 ${attempt} 回目）`,
    '',
    `直前の検証 (verify.md) が不合格でした。判定要約: ${sanitizeRepairReason(reason)}`,
    '',
    '上の verify.md 本文に記載された失敗（失敗テスト・型/lint エラー・未達の受け入れ基準）を確認し、以下を厳守して **実装を修正** してください:',
    '- 失敗を実際に解消する。「成功した」と書くだけ・テスト結果を偽るのは禁止。テストを実際に通すこと。',
    '- スコープ厳守（plan.md 記載外のファイルは変更しない）。',
    '- 失敗の原因が plan.md 記載外のファイルにある場合（既存の壊れたテスト・無関係な lint/型エラー等）は、そのファイルを修正せず `POST /concerns` で懸念バックログに起票し、verify.md に「スコープ外の既存失敗として懸念起票済み」と明記した上で、スコープ内の変更のみで完了してよい（前の項目はスコープ内の失敗にのみ適用される）。',
    REPAIR_FEEDBACK_END,
  ].join('\n');
}

/**
 * Merge a feedback block into the current verify.md: any PREVIOUS feedback
 * block is replaced (not stacked), keeping the file bounded across attempts.
 *
 * @param prior - Current verify.md content. / 現在のverify.md
 * @param block - New marker-wrapped block. / 新しいブロック
 * @returns Merged content. / マージ後の内容
 */
export function mergeRepairFeedback(prior: string, block: string): string {
  const base = prior.replace(REPAIR_FEEDBACK_BLOCK_RE, '').trim();
  return base ? `${base}\n\n---\n\n${block}` : block;
}

/**
 * Write the verify failure back to verify.md so the re-run implementer reads
 * it as feedback (the implementer context surfaces verify.md). Best-effort.
 *
 * @param taskId - Task id / タスクID
 * @param reason - Validator summary / バリデータの要約
 * @param verifyContent - The rejected verify.md (fallback when the file is unreadable) / 却下されたverify.md
 * @param attempt - 1-based attempt number / 試行回数
 */
async function writeRepairFeedback(
  taskId: number,
  reason: string,
  verifyContent: string,
  attempt: number,
): Promise<void> {
  try {
    // Verification feedback belongs to the verify artifact, not question.md
    // (Q&A). The implementer context reads verify.md for this on re-run.
    const prior = (await readWorkflowFile(taskId, 'verify')) ?? verifyContent ?? '';
    const next = mergeRepairFeedback(prior, buildRepairFeedbackBlock(reason, attempt));
    await writeWorkflowFile(taskId, 'verify', next);
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
  const max = await resolveMaxRepairs();
  if (max === 0) return { bounced: false };

  // A completed task is never rolled back by a verify verdict, even when the
  // caller's snapshot says so — completion means a newer verify already passed
  // (and typically a PR exists); this verdict is stale by definition.
  if (currentStatus === 'completed') {
    log.warn(
      { taskId },
      '[verify-repair] Verdict targets an already-completed task — skipping stale bounce',
    );
    return { bounced: false, stale: true };
  }

  const prior = await countPriorRepairs(taskId);
  if (prior >= max) {
    log.warn(
      { taskId, prior, max },
      '[verify-repair] Repair attempts exhausted — caller should block',
    );
    return { bounced: false };
  }

  // Non-convergence cutoff (task 619): the SAME criterion flagged by 2+ repair
  // reasons (repetition, not consecutiveness — A→B→A) means treading water;
  // bounce no further, escalate instead. Independent of the count cap above.
  const verdict = await detectRepairNonConvergence(taskId, reason);
  if (verdict.cutoff) {
    const detail = `受入基準${verdict.criterionIndex}が${verdict.count}回の差し戻しで一度も対応されていません。タスク分割または仕様の見直しが必要です。`;
    const taskRow = await prisma.task
      .findUnique({ where: { id: taskId }, select: { title: true, themeId: true } })
      .catch(() => null);
    try {
      // Dynamic import (ensureRunnerResumes pattern): keeps the escalation
      // module + its dependency chain out of this module's static graph.
      const { escalateBlockedTask } = await import('./blocked-task-escalation');
      await escalateBlockedTask(
        prisma,
        { id: taskId, title: taskRow?.title ?? `#${taskId}`, themeId: taskRow?.themeId ?? null },
        'verify_no_convergence',
        Date.now(),
        detail,
      );
    } catch (err) {
      log.warn({ err, taskId }, '[verify-repair] Non-convergence escalation failed');
    }
    // Recorded LAST so it is the latest transition — hasFreshVerifyRejection
    // reads only the newest row, and this cause must veto the executor epilogue.
    await recordTransition({
      taskId,
      fromStatus: currentStatus ?? null,
      toStatus: currentStatus ?? 'blocked',
      actor: 'system',
      cause: VERIFY_NON_CONVERGENCE_CAUSE,
      phase: 'verify',
      metadata: {
        criterionIndex: verdict.criterionIndex,
        count: verdict.count,
        reason,
      },
    }).catch((err) =>
      log.warn({ err, taskId }, '[verify-repair] Failed to record non-convergence transition'),
    );
    log.warn(
      { taskId, criterionIndex: verdict.criterionIndex, count: verdict.count },
      '[verify-repair] Repair loop not converging — cutting off (caller should block)',
    );
    return { bounced: false, cutoff: true };
  }

  const attempt = prior + 1;
  const newStatus = await resolveImplementEntryStatus(taskId);

  // Compare-and-swap: only roll back if the workflow is STILL at the status
  // this repair evaluated. A verify_repair verdict computed against a stale
  // verify.md can land AFTER a legitimate completion — observed on task 551:
  // an amended plan let a re-verify pass (verify_passed → completed, PR #351
  // created at 20:45), then a late repair for the SUPERSEDED failing verify
  // un-completed the task to plan_approved at 20:46. Same failure family and
  // same guard as the phase-critic gate's task-494 CAS. With no snapshot to
  // compare (currentStatus null), refuse to stomp terminal states instead.
  const rolled = await prisma.task
    .updateMany({
      where: {
        id: taskId,
        workflowStatus: currentStatus ?? { notIn: ['completed', 'verify_done'] },
      },
      data: { status: 'in-progress', workflowStatus: newStatus, updatedAt: new Date() },
    })
    .catch((err) => {
      log.warn({ err, taskId }, '[verify-repair] Failed to reset task to in-progress');
      return null;
    });
  if (!rolled || rolled.count === 0) {
    log.warn(
      { taskId, evaluatedStatus: currentStatus },
      '[verify-repair] Verdict arrived after the workflow moved on — skipping stale bounce',
    );
    return { bounced: false, stale: true };
  }

  // Feedback is written only AFTER the CAS succeeds — a stale bounce must not
  // append its rejection block to a verify.md that already passed.
  await writeRepairFeedback(taskId, reason, verifyContent, attempt);

  await recordTransition({
    taskId,
    fromStatus: currentStatus ?? null,
    toStatus: newStatus,
    actor: 'system',
    cause: REPAIR_CAUSE,
    phase: 'verify',
    metadata: { attempt, max, reason },
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
    { taskId, attempt, max, newStatus },
    '[verify-repair] Bounced verify failure back to implementer',
  );
  return { bounced: true, newStatus, attempt };
}

/**
 * Whether the most recent workflow transition for this task is a fresh
 * verify-phase rejection — a self-repair bounce, an adversarial-review FAIL,
 * a non-convergence cutoff, or a failed PR-creation attempt (see rejectionCauses).
 *
 * The CLI executor's verify epilogue runs AFTER the agent's HTTP verify.md save,
 * so a bounce recorded during that save must veto the epilogue's commit/PR/
 * complete path. Without this check the epilogue completed task 485 seconds
 * after the jury had bounced it, clobbering the self-repair loop. The freshness
 * window guards against stale rows from earlier attempts when a later save
 * bypassed the HTTP handler (executor fallback extraction).
 *
 * @param taskId - Task id / タスクID
 * @param windowMs - Max age for the rejection to count. / 有効期間
 * @returns True when completion must be skipped. / 完了処理を止めるべきか
 */
export async function hasFreshVerifyRejection(
  taskId: number,
  windowMs = 30 * 60_000,
): Promise<boolean> {
  const last = await prisma.workflowTransition
    .findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      select: { cause: true, createdAt: true },
    })
    .catch(() => null);
  if (!last) return false;
  // NOTE: VERIFY_NON_CONVERGENCE_CAUSE counts as a rejection too — a cutoff
  // task (task 619) is blocked-for-escalation and must not be completed by a
  // late executor epilogue any more than a bounced one. 'verify_pr_not_created'
  // is also a rejection: the HTTP file-save gate (verify-commit-pr-pipeline.ts)
  // already tried and failed to produce a PR — without it here, the executor
  // epilogue re-runs the same doomed PR attempt a second time (task 673).
  const rejectionCauses = [
    REPAIR_CAUSE,
    'adversarial_review_failed',
    VERIFY_NON_CONVERGENCE_CAUSE,
    'verify_pr_not_created',
  ];
  if (!rejectionCauses.includes(last.cause)) return false;
  return Date.now() - last.createdAt.getTime() <= windowMs;
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
