/**
 * verification-gate
 *
 * Shared hard gate around runAutomatedVerification, used by BOTH auto-PR paths
 * (post-execution-review and the verify.md-triggered performAutoCommitAndPR) so
 * neither can publish a PR when the agent introduced new lint/type errors.
 *
 * On a new failure it marks the task `blocked` (and the session `failed` with
 * the evidence) and returns ok:false. A crash in the verifier itself is
 * non-fatal — the gate opens (ok:true) rather than blocking on tooling trouble.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import {
  runAutomatedVerification,
  renderVerificationMarkdown,
  looksLikeBugFixTask,
  type VerificationResult,
} from './automated-verifier';
import { readWorkflowFile } from '../../workflow/workflow-file-utils';
import { submitConcern } from '../../memory/concern-backlog-service';
import { writeBlockedStatusDurable } from '../../workflow/durable-blocked-write';
import { resolvePreferredBaseBranch } from '../../task/task-resolver';

const log = createLogger('agents:verification-gate');

/**
 * Loads plan.md content for the scope check. Best-effort: a missing plan
 * (lightweight mode) or a resolution failure simply disables the scope check
 * rather than affecting the gate.
 *
 * @param taskId - Task whose plan to load / 対象タスク
 * @returns plan.md content or null / plan.md の内容
 */
async function loadPlanContent(taskId: number): Promise<string | null> {
  try {
    return (await readWorkflowFile(taskId, 'plan')) || null;
  } catch {
    return null;
  }
}

export interface GateOutcome {
  /** True when the gate is open (no new failures, or verifier skipped/crashed). */
  ok: boolean;
  /** The verification result, or null when the verifier could not run. */
  result: VerificationResult | null;
}

/**
 * Files concerns for pre-existing test failures found during triage. Non-fatal:
 * failures to submit are logged and swallowed so the gate outcome is unaffected.
 * Uses dedupKey `test-baseline:<file>` (task-independent) so the same failing
 * test is filed only once regardless of how many tasks trigger verification.
 *
 * @param taskId - Task whose verification found the failures / 発見タスク
 * @param result - Verification result containing triage data / 検証結果
 */
async function reportPreExistingFailures(
  taskId: number,
  result: VerificationResult,
): Promise<void> {
  const testCheck = result.checks.find((c) => c.name === 'test');
  const preExisting = testCheck?.preExistingFailures;
  if (!preExisting || preExisting.length === 0) return;
  for (const file of preExisting) {
    await submitConcern({
      title: `既存テスト失敗: ${file}`,
      detail: `テストファイル \`${file}\` はエージェントの変更以前から失敗していました。タスク #${taskId} の検証中に検出されました。`,
      type: 'bug',
      severity: 'high',
      location: file,
      originTaskId: taskId,
      source: 'verification-triage',
      dedupKey: `test-baseline:${file}`,
    }).catch((err: unknown) =>
      log.warn({ err, file }, 'Failed to submit pre-existing failure concern (non-fatal)'),
    );
  }
}

/**
 * Runs the automated lint/typecheck gate on a worktree.
 *
 * @param taskId - Task being verified / 検証対象タスク
 * @param worktreePath - The agent's git worktree / エージェントの worktree
 * @param sessionId - Session to fail on a gate block, if known / 失敗にするセッション
 * @returns Gate outcome (ok + result) / ゲート結果
 */
export async function runVerificationGate(
  taskId: number,
  worktreePath: string,
  sessionId?: number,
): Promise<GateOutcome> {
  const planContent = await loadPlanContent(taskId);
  // Bug-fix tasks must ship a reproducing/regression test: a fix that changes
  // no test is exactly the leaky gate SWT-Bench / UTBoost measured (R4).
  const task = await prisma.task
    .findUnique({ where: { id: taskId }, select: { title: true, description: true } })
    .catch(() => null);
  const requireTests = looksLikeBugFixTask(`${task?.title ?? ''}\n${task?.description ?? ''}`);
  // The worktree's ACTUAL fork point, not a guess — see automated-verifier.ts's
  // diffBaseRef doc comment (task 506: a guess-only base can land on a stale
  // branch and misread unrelated pre-existing commits as this task's own
  // out-of-scope/tampering changes, false-failing this HARD gate).
  // NOTE: theme.defaultBranch, not AgentExecutionConfig.targetBranch alone
  // (task 511: that table is empty for the autonomous pipeline) — see
  // resolvePreferredBaseBranch's doc comment.
  const preferredBaseBranch = await resolvePreferredBaseBranch(taskId);
  const result = await runAutomatedVerification(worktreePath, {
    planContent,
    requireTests,
    preferredBaseBranch,
    taskId,
  }).catch((err) => {
    log.warn({ err, taskId }, 'Automated verification crashed — skipping gate');
    return null;
  });
  if (!result) return { ok: true, result: null };

  // Report pre-existing failures as concerns before the gate verdict is applied.
  // Runs regardless of ok/NG so concerns are filed even when the gate passes.
  await reportPreExistingFailures(taskId, result);

  if (result.ok) {
    log.info({ taskId, summary: result.summary }, 'Automated verification passed');
    return { ok: true, result };
  }

  await blockTaskForVerification(taskId, result, sessionId);
  return { ok: false, result };
}

/**
 * Marks a task blocked (and its session failed with the verification evidence)
 * after the automated checks found new lint/type errors. Exposed so the retry
 * loop can use it once retries are exhausted.
 *
 * @param taskId - Task to block / ブロックするタスク
 * @param result - The failing verification result / 失敗した検証結果
 * @param sessionId - Session to fail, if known / 失敗にするセッション
 */
export async function blockTaskForVerification(
  taskId: number,
  result: VerificationResult,
  sessionId?: number,
): Promise<void> {
  log.error(
    { taskId, sessionId, summary: result.summary },
    'Automated verification failed — blocking',
  );
  // DURABLE WRITE: `status: 'blocked'` is the terminal action that actually
  // stops the self-repair retry loop (verification-retry.ts reads task status
  // via this same block path). A bare `.catch(() => warn)` here used to let
  // the write silently no-op, leaving the task looking un-blocked to any
  // downstream automation even though verification genuinely failed.
  await writeBlockedStatusDurable({
    taskId,
    log,
    source: 'verification-gate',
    notification: {
      title: '検証失敗タスクのブロック処理に失敗',
      message: `タスク #${taskId} は自動検証に失敗しましたが、ブロック状態として記録できませんでした。手動で確認してください。`,
    },
  });
  if (sessionId !== undefined) {
    await markSessionFailedDurable(sessionId, taskId, result);
  }
}

/**
 * Marks a session `failed` with the verification evidence, retrying once on
 * failure. Mirrors `writeBlockedStatusDurable`'s retry-once pattern: without
 * it, a swallowed write here left the session stuck `running` with no active
 * process even though the task itself was correctly blocked above.
 *
 * @param sessionId - Session to fail / 失敗にするセッション
 * @param taskId - Owning task, for log context / ログ用のタスクID
 * @param result - The failing verification result / 失敗した検証結果
 */
async function markSessionFailedDurable(
  sessionId: number,
  taskId: number,
  result: VerificationResult,
): Promise<void> {
  const data = {
    status: 'failed' as const,
    completedAt: new Date(),
    errorMessage: `自動検証に失敗しました（${result.summary}）。エージェントの変更が新たな lint/型エラーを混入しています。worktree は保持しています。\n\n${renderVerificationMarkdown(result)}`,
  };
  const attempt = () =>
    prisma.agentSession
      .update({ where: { id: sessionId }, data })
      .then(() => true)
      .catch(() => false);

  if (await attempt()) return;
  log.warn({ taskId, sessionId }, 'Failed to mark session failed — retrying once');
  if (await attempt()) return;
  log.error(
    { taskId, sessionId },
    'Failed to mark session failed twice — session may remain stuck running',
  );
}
