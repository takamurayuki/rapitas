/**
 * Workflow Activity Logger
 *
 * Helper functions for recording auto-commit, auto-PR, and auto-merge events
 * in the ActivityLog and Notification tables.
 * Not responsible for triggering git operations or route handling.
 */

import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { logCycleEvent } from '../../services/observability';
import { buildNotificationI18n } from '../../services/communication/notification-i18n';

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
 * @param alreadyCommitted - True when nothing new was staged because the agent
 *        had already committed; the counts then describe the whole branch.
 *        / 既にコミット済みで新規ステージが無かった場合 true（数値はブランチ全体）
 */
export async function logAutoCommit(
  taskId: number,
  hash: string,
  branch: string,
  filesChanged: number,
  additions: number,
  deletions: number,
  alreadyCommitted = false,
): Promise<void> {
  await prisma.activityLog.create({
    data: {
      taskId,
      action: 'auto_commit_created',
      metadata: JSON.stringify({
        hash,
        branch,
        filesChanged,
        additions,
        deletions,
        alreadyCommitted,
      }),
      createdAt: new Date(),
    },
  });

  // NOTE: `alreadyCommitted` distinguishes "this step committed N files" from
  // "this step staged nothing; the branch already carries N files". Without it
  // a real 996-line commit was logged as `filesChanged:0`, which reads as "the
  // agent produced nothing" — the opposite of the truth.
  logCycleEvent('commit.created', {
    task: taskId,
    hash: hash.slice(0, 12),
    branch,
    filesChanged,
    additions,
    deletions,
    alreadyCommitted,
    msg: alreadyCommitted ? 'branch already committed (no new stage)' : 'auto-commit created',
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
      title: '自動PR作成完了',
      message: `タスク「${taskTitle}」のPRを自動作成しました: ${prUrl}`,
      link: prUrl || `/tasks/${taskId}`,
      metadata: JSON.stringify({
        taskId,
        prUrl,
        prNumber,
        i18n: buildNotificationI18n('auto_pr_created', { taskTitle, prUrl }),
      }),
    },
  });

  logCycleEvent('pr.created', {
    task: taskId,
    ok: true,
    prNumber,
    prUrl,
    msg: 'auto-PR created',
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
      title: '自動マージ完了',
      message: `タスク「${taskTitle}」のPRを自動マージしました（${mergeStrategy}）`,
      link: prUrl || `/tasks/${taskId}`,
      metadata: JSON.stringify({
        taskId,
        prNumber,
        mergeStrategy,
        i18n: buildNotificationI18n('auto_pr_merged', { taskTitle, mergeStrategy }),
      }),
    },
  });

  logCycleEvent('pr.merged', {
    task: taskId,
    ok: true,
    prNumber,
    mergeStrategy,
    msg: 'auto-merge complete',
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
        title: '自動マージ失敗',
        message: `タスク「${taskTitle}」のPR自動マージに失敗しました: ${error}`,
        link: prUrl || `/tasks/${taskId}`,
        metadata: JSON.stringify({
          taskId,
          prNumber,
          error,
          i18n: buildNotificationI18n('auto_pr_merge_failed', { taskTitle, error }),
        }),
      },
    });
  } catch (notifError) {
    log.error({ err: notifError }, 'Failed to create merge failure notification');
  }

  logCycleEvent('pr.merge_failed', {
    task: taskId,
    ok: false,
    cause: 'auto_merge_failed',
    prNumber,
    detail: error?.slice(0, 200),
    msg: 'auto-merge failed',
  });
}
