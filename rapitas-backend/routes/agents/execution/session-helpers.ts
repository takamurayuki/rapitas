/**
 * execution/session-helpers
 *
 * Shared async utilities used across multiple execution route handlers:
 * - Updating AgentSession status with retry logic
 * - Creating code review ApprovalRequest records after task completion
 */

import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';
import { toJsonString } from '../../../utils/db-helpers';
import {
  cleanImplementationSummary,
  sanitizeScreenshots,
} from '../../../utils/agent-response-cleaner';
import { captureScreenshotsForDiff } from '../../../services/screenshot-service';
import type { ScreenshotResult } from '../../../services/screenshot-service';

const log = createLogger('routes:agent-execution:helpers');
const agentWorkerManager = AgentWorkerManager.getInstance();

// NOTE: sanitizeScreenshots is imported for potential future use in approval payloads.
void sanitizeScreenshots;

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
  status: 'completed' | 'failed',
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

/** Parameters for createCodeReviewApproval. */
export interface CreateCodeReviewApprovalParams {
  taskId: number;
  taskTitle: string;
  configId: number;
  sessionId: number;
  workDir: string;
  branchName?: string;
  resultOutput?: string;
  executionTimeMs?: number;
  logPrefix: string;
}

/**
 * Creates an ApprovalRequest for code review after task execution completes.
 * Captures screenshots for changed UI files and respects the autoApprove config flag.
 * Non-fatal: errors are logged but not re-thrown.
 *
 * @param params - Code review approval parameters / コードレビュー承認リクエストパラメータ
 */
export async function createCodeReviewApproval(
  params: CreateCodeReviewApprovalParams,
): Promise<void> {
  const {
    taskId,
    taskTitle,
    configId,
    sessionId,
    workDir,
    branchName,
    resultOutput,
    executionTimeMs,
    logPrefix,
  } = params;

  try {
    const diff = await agentWorkerManager.getFullGitDiff(workDir);
    const structuredDiff = await agentWorkerManager.getDiff(workDir);

    if (diff && diff !== 'No changes detected') {
      const implementationSummary = cleanImplementationSummary(
        resultOutput || 'Implementation completed.',
      );

      let screenshots: ScreenshotResult[] = [];
      try {
        screenshots = await captureScreenshotsForDiff(structuredDiff, {
          workingDirectory: workDir,
          agentOutput: resultOutput || '',
        });
        if (screenshots.length > 0) {
          log.info(
            `${logPrefix} Captured ${screenshots.length} screenshots for task ${taskId}: ${screenshots.map((s) => s.page).join(', ')}`,
          );
        }
      } catch (screenshotErr) {
        log.warn({ err: screenshotErr }, `${logPrefix} Screenshot capture failed (non-fatal)`);
      }

      const devConfig = await prisma.developerModeConfig.findUnique({
        where: { id: configId },
        select: { autoApprove: true },
      });
      const isAutoApprove = devConfig?.autoApprove === true;

      try {
        const approvalRequest = await prisma.approvalRequest.create({
          data: {
            configId,
            requestType: 'code_review',
            title: `Code review for "${taskTitle}"`,
            description: implementationSummary,
            status: isAutoApprove ? 'approved' : 'pending',
            proposedChanges:
              toJsonString({
                taskId,
                sessionId,
                workingDirectory: workDir,
                branchName,
                structuredDiff,
                implementationSummary,
                executionTimeMs,
                screenshots,
              }) ?? '',
            executionType: 'code_review',
            estimatedChanges: toJsonString({
              filesChanged: structuredDiff.length,
              summary: implementationSummary.substring(0, 500),
            }),
            ...(isAutoApprove && { approvedAt: new Date() }),
          },
        });

        if (isAutoApprove) {
          log.info(
            `${logPrefix} Auto-approved code review for task ${taskId} (approval #${approvalRequest.id})`,
          );
        } else {
          log.info(
            `${logPrefix} Created code review approval #${approvalRequest.id} for task ${taskId}`,
          );
        }
      } catch (approvalError) {
        log.error(
          { err: approvalError },
          `${logPrefix} Failed to create approval request for task ${taskId}`,
        );
      }
    }
  } catch (diffError) {
    log.error({ err: diffError }, `${logPrefix} Failed to get diff for task ${taskId}`);
  }
}
