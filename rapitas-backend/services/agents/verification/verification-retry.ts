/**
 * verification-retry
 *
 * Self-repair loop: when automated verification finds NEW lint/type errors, feed
 * those errors back to the implementer agent and re-run it on the SAME worktree,
 * up to a bounded number of attempts. After the cap is hit, the task is blocked
 * with the evidence (via blockTaskForVerification).
 *
 * The retry counter lives in AgentSession.metadata JSON (no schema change). The
 * caller passes an `onReverify` callback (the post-execution review) so we re-run
 * verification after each fix attempt without a circular import.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { AgentWorkerManager } from '../agent-worker-manager';
import { blockTaskForVerification } from './verification-gate';
import { renderVerificationMarkdown, type VerificationResult } from './automated-verifier';

const log = createLogger('agents:verification-retry');
const agentWorkerManager = AgentWorkerManager.getInstance();

/** Default max self-repair attempts when the task has no explicit maxRetries. */
const DEFAULT_MAX_RETRIES = 2;
const META_KEY = 'verificationRetries';

/** Reads the verification-retry count from a session.metadata JSON string. */
export function parseRetryCount(metadata: string | null | undefined): number {
  if (!metadata) return 0;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    const n = obj[META_KEY];
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Returns a new metadata JSON string with the retry count set. */
export function withRetryCount(metadata: string | null | undefined, count: number): string {
  let obj: Record<string, unknown> = {};
  if (metadata) {
    try {
      obj = JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  }
  obj[META_KEY] = count;
  return JSON.stringify(obj);
}

/**
 * Builds the implementer feedback instruction from a failing verification.
 * Pure — the retry loop's testable core.
 */
export function buildFixInstruction(result: VerificationResult, attempt: number): string {
  return [
    `前回の実装は自動検証（lint / 型チェック）で **新たなエラー** が検出されました（自己修復 ${attempt} 回目）。`,
    'コードを一切壊さずに、以下のエラーだけを最小限の変更で修正してください。新機能の追加や無関係なリファクタは禁止です。',
    '',
    renderVerificationMarkdown(result),
    '',
    '修正後は変更ファイルの lint と型チェックが通る状態にしてください。',
  ].join('\n');
}

export interface RetryParams {
  taskId: number;
  sessionId: number;
  taskTitle: string;
  executionDir: string;
  result: VerificationResult;
  /** Re-run verification after the fix attempt completes (e.g. reviewAndCommitWorktree). */
  onReverify: () => Promise<void>;
}

/**
 * Either re-runs the implementer with the verification errors as feedback, or
 * (when retries are exhausted) blocks the task.
 *
 * @param params - Retry context / リトライのコンテキスト
 * @returns Whether a retry was triggered / リトライを開始したか
 */
export async function retryOrBlock(params: RetryParams): Promise<{ retried: boolean }> {
  const { taskId, sessionId, taskTitle, executionDir, result, onReverify } = params;

  // An "unverifiable" result means the tooling itself could not run (e.g. a
  // worktree without linked node_modules) — self-repair cannot fix that, so
  // block immediately instead of burning retry attempts on the agent.
  if (result.unverifiable) {
    log.error({ taskId, sessionId }, 'Verification unrunnable (tooling) — blocking without retry');
    await blockTaskForVerification(taskId, result, sessionId);
    return { retried: false };
  }

  const session = await prisma.agentSession
    .findUnique({ where: { id: sessionId }, select: { metadata: true } })
    .catch(() => null);
  const attempt = parseRetryCount(session?.metadata) + 1;

  const execConfig = await prisma.agentExecutionConfig
    .findUnique({ where: { taskId }, select: { maxRetries: true } })
    .catch(() => null);
  const maxRetries =
    typeof execConfig?.maxRetries === 'number' && execConfig.maxRetries > 0
      ? execConfig.maxRetries
      : DEFAULT_MAX_RETRIES;

  if (attempt > maxRetries) {
    log.warn({ taskId, attempt, maxRetries }, 'Self-repair retries exhausted — blocking task');
    await blockTaskForVerification(taskId, result, sessionId);
    return { retried: false };
  }

  // Reuse the same agent that produced the changes.
  const lastExecution = await prisma.agentExecution
    .findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      select: { agentConfigId: true },
    })
    .catch(() => null);

  // Persist the incremented counter before launching, so a crash can't loop.
  const counterPersisted = await prisma.agentSession
    .update({
      where: { id: sessionId },
      data: { metadata: withRetryCount(session?.metadata, attempt), status: 'running' },
    })
    .then(() => true)
    .catch((err) => {
      log.warn({ err, sessionId }, 'Failed to persist retry count');
      return false;
    });

  // FAIL CLOSED: if the incremented counter can't be persisted, `attempt` will
  // be re-derived as the SAME stale value next time (parseRetryCount reads the
  // old metadata), so the cap in this function would never trip and the agent
  // could be relaunched unboundedly. Treat a persist failure as terminal for
  // this attempt and block rather than proceeding on an unrecorded retry.
  if (!counterPersisted) {
    log.error(
      { taskId, sessionId, attempt },
      'Could not persist retry counter — blocking task instead of risking an unbounded retry loop',
    );
    await blockTaskForVerification(taskId, result, sessionId);
    return { retried: false };
  }

  log.info({ taskId, sessionId, attempt, maxRetries }, 'Triggering self-repair retry');

  const instruction = buildFixInstruction(result, attempt);
  agentWorkerManager
    .executeTask(
      { id: taskId, title: taskTitle, description: instruction, workingDirectory: executionDir },
      {
        taskId,
        sessionId,
        agentConfigId: lastExecution?.agentConfigId ?? undefined,
        workingDirectory: executionDir,
        continueFromPrevious: true,
      },
    )
    .then(() => onReverify())
    .catch((err) => log.warn({ err, taskId, sessionId }, 'Self-repair retry execution failed'));

  return { retried: true };
}
