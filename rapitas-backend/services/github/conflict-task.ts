/**
 * conflict-task
 *
 * Files (idempotently) the agent task that resolves a PR's merge conflicts on the
 * PR branch. Shared by the manual "競合解消" button (pull-requests route) and the
 * AutoMergeWatcher, so an auto-run PR that cannot merge due to a conflict is
 * resolved + re-merged with NO human step. Resolving a conflict is mechanical
 * (merge base → fix markers → push), so the task is pinned to lightweight mode.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('github:conflict-task');

/** Minimal PR shape needed to author the resolution instructions. */
export interface ConflictPrInfo {
  prNumber: number;
  title: string;
  baseBranch: string;
  headBranch: string;
}

/** Task statuses that mean a conflict task is still doing its job (don't re-file). */
const ACTIVE_STATUSES = ['todo', 'in-progress', 'blocked'];

/** Outcome of a file attempt: the task id and whether it was freshly created. */
export interface FileConflictTaskResult {
  taskId: number | null;
  /** True when a new task was created; false when an active one already existed. */
  created: boolean;
}

/**
 * Files the "PR #N の競合を解消" task, or returns the id of an existing ACTIVE one
 * (dedup) so the watcher doesn't re-file it every tick.
 *
 * @param pr - The conflicting PR. / 競合中のPR
 * @param workingDirectory - Local checkout the agent resolves in. / 解消する作業ディレクトリ
 * @param themeId - Theme to attribute the task to (for auto-run pickup). / テーマID
 * @returns The task id + whether it was newly created. / タスクIDと新規作成フラグ
 */
export async function fileConflictResolutionTask(
  pr: ConflictPrInfo,
  workingDirectory: string,
  themeId: number | null,
): Promise<FileConflictTaskResult> {
  // Dedup: an active conflict task for this PR is already resolving it.
  const existing = await prisma.task
    .findFirst({
      where: {
        githubPrId: pr.prNumber,
        title: { startsWith: `PR #${pr.prNumber} の競合を解消` },
        status: { in: ACTIVE_STATUSES },
      },
      select: { id: true },
    })
    .catch(() => null);
  if (existing) {
    log.debug({ prNumber: pr.prNumber, taskId: existing.id }, 'Conflict task already active');
    return { taskId: existing.id, created: false };
  }

  const instruction = [
    `PR #${pr.prNumber}「${pr.title}」のマージ競合を解消してください。`,
    `- マージ先(base): ${pr.baseBranch}`,
    `- PRブランチ(head): ${pr.headBranch}`,
    '',
    '手順:',
    `1. git fetch origin ${pr.baseBranch} ${pr.headBranch}`,
    `2. git checkout ${pr.headBranch}（無ければ git checkout -b ${pr.headBranch} origin/${pr.headBranch}）`,
    `3. git merge origin/${pr.baseBranch} を実行`,
    '4. 競合を両者の意図を保ちつつ解消し、競合マーカー(<<<<<<< など)を残さない',
    '5. 変更を commit',
    `6. git push origin ${pr.headBranch} でPRブランチを更新`,
    '',
    '重要: 解消は PR ブランチへの push で完結し、このタスクの worktree には差分が残らないため、',
    'verify.md に必ず「変更不要: 競合解消は PR ブランチへ push 済み」と明記してください',
    '（空diffで誤ブロックされるのを防ぐため）。新規 PR は作成不要です。',
  ].join('\n');

  const task = await prisma.task
    .create({
      data: {
        title: `PR #${pr.prNumber} の競合を解消`,
        description: instruction,
        status: 'todo',
        priority: 'high',
        isDeveloperMode: true,
        ...(themeId != null && { themeId }),
        workingDirectory,
        // Link the existing PR so completion is NOT blocked by the "a PR must be
        // created" gate — a conflict task updates PR #N, it never opens a new one.
        githubPrId: pr.prNumber,
        // Mechanical (merge base → fix markers → push): pin to lightweight so the
        // complexity scorer (which over-rates it via the embedded PR title) does
        // not waste a plan phase, and override so staging won't recompute it up.
        workflowMode: 'lightweight',
        workflowModeOverride: true,
        complexityScore: 15,
      },
      select: { id: true },
    })
    .catch((err) => {
      log.warn({ err, prNumber: pr.prNumber }, 'Failed to create conflict task');
      return null;
    });

  if (task) {
    log.info({ prNumber: pr.prNumber, taskId: task.id }, 'Filed conflict-resolution task');
  }
  return { taskId: task?.id ?? null, created: task != null };
}
