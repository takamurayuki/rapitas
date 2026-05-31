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
  type VerificationResult,
} from './automated-verifier';

const log = createLogger('agents:verification-gate');

export interface GateOutcome {
  /** True when the gate is open (no new failures, or verifier skipped/crashed). */
  ok: boolean;
  /** The verification result, or null when the verifier could not run. */
  result: VerificationResult | null;
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
  const result = await runAutomatedVerification(worktreePath).catch((err) => {
    log.warn({ err, taskId }, 'Automated verification crashed — skipping gate');
    return null;
  });
  if (!result) return { ok: true, result: null };
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
  log.error({ taskId, sessionId, summary: result.summary }, 'Automated verification failed — blocking');
  await prisma.task
    .update({ where: { id: taskId }, data: { status: 'blocked', updatedAt: new Date() } })
    .catch((err) => log.warn({ err, taskId }, 'Failed to mark task blocked'));
  if (sessionId !== undefined) {
    await prisma.agentSession
      .update({
        where: { id: sessionId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: `自動検証に失敗しました（${result.summary}）。エージェントの変更が新たな lint/型エラーを混入しています。worktree は保持しています。\n\n${renderVerificationMarkdown(result)}`,
        },
      })
      .catch((err) => log.warn({ err, sessionId }, 'Failed to mark session failed'));
  }
}
