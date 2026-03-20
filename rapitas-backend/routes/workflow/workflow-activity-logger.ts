/**
 * Workflow Activity Logger
 *
 * Helper functions for recording auto-commit, auto-PR, and auto-merge events
 * in the ActivityLog and Notification tables.
 * Not responsible for triggering git operations or route handling.
 */

import { prisma } from '../../config';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:workflow:activity-logger');

/**
 * Record a successful auto-commit in the ActivityLog.
 *
 * @param taskId - Task ID / タスクID
 * @param hash - Commit hash / コミットハッシュ
 * @param branch - Branch name / ブランチ名
 * @param filesChanged - Number of changed files / 変更ファイル数
 * @param additions - Lines added / 追加行数
 * @param deletions - Lines deleted / 削除行数
 */
export async function logAutoCommit(
  taskId: number,
  hash: string,
  branch: string,
  filesChanged: number,
  additions: number,
  deletions: number,
): Promise<void> {
  await prisma.activityLog.create({
    data: {
      taskId,
      action: 'auto_commit_created',
      metadata: JSON.stringify({ hash, branch, filesChanged, additions, deletions }),
      createdAt: new Date(),
    },
  });
}

/**
 * Record a successful auto-PR creation in ActivityLog and Notification.
 *
 * @param taskId - Task ID / タスクID
 * @param taskTitle - Task title for notification message / 通知メッセージ用タスクタイトル
 * @param prUrl - PR URL / PR URL
 * @param prNumber - PR number / PR番号
 */
export async function logAutoPR(
  taskId: number,
  taskTitle: string,
  prUrl: string | undefined,
  prNumber: number | undefined,
): Promise<void> {
  await prisma.activityLog.create({
    data: {
      taskId,
      action: 'auto_pr_created',
      metadata: JSON.stringify({ prUrl, prNumber }),
      createdAt: new Date(),
    },
  });

  await prisma.notification.create({
    data: {
      type: 'auto_pr_created',
      title: 'Auto PR Creation Complete',
      message: `PR for task "${taskTitle}" was automatically created: ${prUrl}`,
      link: prUrl || `/tasks/${taskId}`,
      metadata: JSON.stringify({ taskId, prUrl, prNumber }),
    },
  });
}

/**
 * Record a successful auto-merge in ActivityLog and Notification.
 *
 * @param taskId - Task ID / タスクID
 * @param taskTitle - Task title for notification message / 通知メッセージ用タスクタイトル
 * @param prNumber - PR number / PR番号
 * @param prUrl - PR URL / PR URL
 * @param mergeStrategy - Strategy used (squash/merge) / マージ戦略
 */
export async function logAutoMerge(
  taskId: number,
  taskTitle: string,
  prNumber: number,
  prUrl: string | undefined,
  mergeStrategy: string | undefined,
): Promise<void> {
  await prisma.activityLog.create({
    data: {
      taskId,
      action: 'auto_pr_merged',
      metadata: JSON.stringify({ prNumber, prUrl, mergeStrategy }),
      createdAt: new Date(),
    },
  });

  await prisma.notification.create({
    data: {
      type: 'auto_pr_merged',
      title: 'Auto Merge Complete',
      message: `PR for task "${taskTitle}" was automatically merged (${mergeStrategy})`,
      link: prUrl || `/tasks/${taskId}`,
      metadata: JSON.stringify({ taskId, prNumber, mergeStrategy }),
    },
  });
}

/**
 * Record an auto-merge failure in Notification.
 * Does not fail the overall workflow.
 *
 * @param taskId - Task ID / タスクID
 * @param taskTitle - Task title for notification message / 通知メッセージ用タスクタイトル
 * @param prNumber - PR number / PR番号
 * @param prUrl - PR URL / PR URL
 * @param error - Error message / エラーメッセージ
 */
export async function logAutoMergeFailure(
  taskId: number,
  taskTitle: string,
  prNumber: number,
  prUrl: string | undefined,
  error: string | undefined,
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        type: 'auto_pr_merge_failed',
        title: 'Auto Merge Failed',
        message: `Automatic merge of PR for task "${taskTitle}" failed: ${error}`,
        link: prUrl || `/tasks/${taskId}`,
        metadata: JSON.stringify({ taskId, prNumber, error }),
      },
    });
  } catch (notifError) {
    log.error({ err: notifError }, 'Failed to create merge failure notification');
  }
}
