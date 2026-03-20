/**
 * Agent Resume Handlers
 *
 * Async post-resume completion logic: task status updates, approval requests,
 * and notification creation after orchestrator.resumeInterruptedExecution() settles.
 * Not responsible for route definitions or deciding whether to resume.
 */

import { join } from 'path';
import { prisma, getProjectRoot } from '../../../config';
import { createLogger } from '../../../config/logger';
import { toJsonString } from '../../../utils/database/db-helpers';
import { orchestrator } from '../../../services/core/orchestrator-instance';
import {
  cleanImplementationSummary,
  sanitizeScreenshots,
} from '../../../utils/agent/agent-response-cleaner';
import { captureScreenshotsForDiff } from '../../../services/misc/screenshot-service';
import type { ScreenshotResult } from '../../../services/misc/screenshot-service';

const log = createLogger('routes:agent-resume');

type TaskInfo = {
  id: number;
  title: string;
  description: string | null;
  theme: { name: string | null; workingDirectory: string | null } | null;
};

type ExecutionInfo = {
  sessionId: number;
  session: {
    config: {
      id: number;
      taskId: number;
    } | null;
  };
};

/**
 * Runs orchestrator.resumeInterruptedExecution and handles the async result:
 * updates task status, creates approval requests, and sends notifications.
 * Designed to be called without awaiting — fire-and-forget after returning HTTP response.
 *
 * @param executionId - DB id of the interrupted execution / 中断された実行のDB ID
 * @param execution - Execution record with session/config included / セッション/config付きの実行レコード
 * @param task - Task associated with the execution / 実行に関連するタスク
 * @param workingDirectory - Verified working directory / 検証済み作業ディレクトリ
 * @param timeout - Resume timeout in milliseconds / 再開タイムアウト（ミリ秒）
 */
export function handleResumeCompletion(
  executionId: number,
  execution: ExecutionInfo,
  task: TaskInfo,
  workingDirectory: string,
  timeout: number,
): void {
  orchestrator
    .resumeInterruptedExecution(executionId, { timeout })
    .then(async (result) => {
      if (result.success && !result.waitingForInput) {
        await updateTaskStatusOnSuccess(task, execution, workingDirectory, result);
      } else if (result.waitingForInput) {
        log.info(`[resume] Task ${task.id} is waiting for input after resume`);
      } else {
        await handleResumeFailure(task, execution, result.errorMessage);
      }
    })
    .catch(async (error) => {
      log.error({ err: error }, '[resume] Resume execution error');
      await handleResumeError(task, execution, error);
    });
}

/**
 * Updates task and session status when resume completes successfully, then creates
 * an approval request with diff and screenshots if code changes were detected.
 */
async function updateTaskStatusOnSuccess(
  task: TaskInfo,
  execution: ExecutionInfo,
  workingDirectory: string,
  result: Awaited<ReturnType<typeof orchestrator.resumeInterruptedExecution>>,
): Promise<void> {
  const currentTask = await prisma.task.findUnique({ where: { id: task.id } });
  const wfStatus = currentTask?.workflowStatus;

  if (wfStatus && ['plan_created', 'research_done', 'verify_done'].includes(wfStatus)) {
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'in-progress' },
    });
    log.info(`[resume] Task ${task.id} kept as in-progress (workflow: ${wfStatus})`);
  } else if (wfStatus === 'in_progress' || wfStatus === 'plan_approved') {
    log.info(`[resume] Task ${task.id} kept as in-progress (workflow: ${wfStatus})`);
  } else if (wfStatus === 'completed') {
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'done', completedAt: new Date() },
    });
    log.info(`[resume] Updated task ${task.id} status to 'done'`);
  } else {
    // draft or unknown — treat as done
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'done', completedAt: new Date() },
    });
    log.info(`[resume] Updated task ${task.id} status to 'done' (workflow: ${wfStatus ?? 'none'})`);
  }

  await prisma.agentSession
    .update({
      where: { id: execution.sessionId },
      data: { status: 'completed', completedAt: new Date() },
    })
    .catch((err: unknown) => {
      log.warn(
        { err, sessionId: execution.sessionId },
        '[resume] Failed to mark session as completed',
      );
    });

  const diff = await orchestrator.getFullGitDiff(workingDirectory);
  if (diff && diff !== 'No changes detected') {
    await createApprovalForResumedWork(task, execution, workingDirectory, result);
  } else {
    await prisma.notification.create({
      data: {
        type: 'agent_execution_complete',
        title: 'エージェント実行完了（変更なし）',
        message: `「${task.title}」の再開した作業が完了しましたが、コード変更はありませんでした。`,
        link: `/tasks/${task.id}`,
      },
    });
  }
}

/**
 * Creates an approval request with structured diff and screenshots for resumed work.
 */
async function createApprovalForResumedWork(
  task: TaskInfo,
  execution: ExecutionInfo,
  workingDirectory: string,
  result: Awaited<ReturnType<typeof orchestrator.resumeInterruptedExecution>>,
): Promise<void> {
  const structuredDiff = await orchestrator.getDiff(workingDirectory);
  const implementationSummary = cleanImplementationSummary(
    result.output || '再開した作業が完了しました。',
  );

  let screenshots: ScreenshotResult[] = [];
  try {
    screenshots = await captureScreenshotsForDiff(structuredDiff, {
      workingDirectory,
      agentOutput: result.output || '',
    });
    if (screenshots.length > 0) {
      log.info(
        `[agent-resume] Captured ${screenshots.length} screenshots for task ${task.id}: ${screenshots.map((s) => s.page).join(', ')}`,
      );
    }
  } catch (screenshotErr) {
    log.warn({ err: screenshotErr }, '[agent-resume] Screenshot capture failed (non-fatal)');
  }

  const screenshotData = sanitizeScreenshots(screenshots);
  const config = execution.session.config;
  if (!config) return;

  log.info(
    `[agent-resume] Creating approval with ${screenshotData.length} screenshot(s): ${screenshotData.map((s) => s.url).join(', ')}`,
  );

  const approvalRequest = await prisma.approvalRequest.create({
    data: {
      configId: config.id,
      requestType: 'code_review',
      title: `「${task.title}」のコードレビュー（再開後）`,
      description: implementationSummary,
      proposedChanges:
        toJsonString({
          taskId: task.id,
          sessionId: execution.sessionId,
          workingDirectory,
          structuredDiff,
          implementationSummary,
          executionTimeMs: result.executionTimeMs,
          resumed: true,
          screenshots: screenshotData,
        }) ?? '',
      executionType: 'code_review',
      estimatedChanges: toJsonString({
        filesChanged: structuredDiff.length,
        summary: implementationSummary.substring(0, 500),
      }),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.notification.create({
    data: {
      type: 'pr_review_requested',
      title: 'コードレビュー依頼（再開後）',
      message: `「${task.title}」の再開した作業が完了しました。レビューをお願いします。`,
      link: `/approvals/${approvalRequest.id}`,
    },
  });
}

/**
 * Handles the case where orchestrator.resumeInterruptedExecution resolves with success=false.
 */
async function handleResumeFailure(
  task: TaskInfo,
  execution: ExecutionInfo,
  errorMessage: string | undefined,
): Promise<void> {
  await prisma.task.update({ where: { id: task.id }, data: { status: 'todo' } });
  log.info(`[resume] Reverted task ${task.id} status to 'todo' due to failure`);

  await prisma.agentSession
    .update({
      where: { id: execution.sessionId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: errorMessage || 'Execution failed after resume',
      },
    })
    .catch(() => {});

  await prisma.notification.create({
    data: {
      type: 'agent_error',
      title: '再開した実行が失敗',
      message: `「${task.title}」の再開した作業が失敗しました: ${errorMessage}`,
      link: `/tasks/${task.id}`,
    },
  });
}

/**
 * Handles the case where orchestrator.resumeInterruptedExecution rejects.
 */
async function handleResumeError(
  task: TaskInfo,
  execution: ExecutionInfo,
  error: Error,
): Promise<void> {
  await prisma.task
    .update({ where: { id: task.id }, data: { status: 'todo' } })
    .catch((err: unknown) => {
      log.warn({ err, taskId: task.id }, "[resume] Failed to revert task status to 'todo'");
    });
  log.info(`[resume] Reverted task ${task.id} status to 'todo' due to error`);

  await prisma.agentSession
    .update({
      where: { id: execution.sessionId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: error.message || 'Resume execution error',
      },
    })
    .catch((err: unknown) => {
      log.warn(
        { err, sessionId: execution.sessionId },
        '[resume] Failed to mark session as failed',
      );
    });

  await prisma.notification.create({
    data: {
      type: 'agent_error',
      title: '実行再開エラー',
      message: `「${task.title}」の再開中にエラーが発生しました: ${error.message}`,
      link: `/tasks/${task.id}`,
    },
  });
}
