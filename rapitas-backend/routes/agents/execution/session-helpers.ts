/**
 * execution/session-helpers
 *
 * Shared async utilities used across multiple execution route handlers:
 * - Updating AgentSession status with retry logic
 *
 * (Code-review ApprovalRequest creation was removed — a completed task's PR is
 * opened directly instead of going through a review/approval step.)
 */

import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:agent-execution:helpers');

/**
 * Updates an AgentSession's terminal status with exponential-backoff retry.
 * Retries up to maxRetries times on Prisma errors (e.g. transient connection issues).
 *
 * @param sessionId - Session to update / 更新対象セッションID
 * @param status - Target terminal status / 更新後ステータス
 * @param logPrefix - Log prefix for identifying the calling route / ログプレフィックス
 * @param maxRetries - Maximum retry count (default 3) / 最大リトライ回数
 */
export async function updateSessionStatusWithRetry(
  sessionId: number,
  status: 'completed' | 'failed' | 'interrupted',
  logPrefix: string = '',
  maxRetries: number = 3,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.agentSession.update({
        where: { id: sessionId },
        data: {
          status,
          completedAt: new Date(),
          ...(status === 'failed' && { errorMessage: 'Execution failed' }),
        },
      });

      if (attempt > 1) {
        log.info(
          `${logPrefix} Session ${sessionId} status updated to ${status} on attempt ${attempt}`,
        );
      }
      return;
    } catch (error) {
      lastError = error;
      log.warn(
        { err: error },
        `${logPrefix} Failed to update session ${sessionId} status (attempt ${attempt}/${maxRetries})`,
      );

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  log.error(
    { err: lastError },
    `${logPrefix} Failed to update session ${sessionId} status after ${maxRetries} attempts`,
  );
}
