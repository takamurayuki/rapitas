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

// After a finished attempt, wait before re-queueing so GitHub can recompute the
// PR's mergeability from the resolution push. Without this, a just-completed task
// is re-queued on a stale CONFLICTING reading (the push hasn't been re-evaluated
// yet) — a self-inflicted churn race.
const RECONFLICT_COOLDOWN_MS = 10 * 60 * 1000;

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

  // At most ONE conflict task per PR. Find the most recent one REGARDLESS of
  // status — a completed-but-ineffective attempt (the PR re-conflicted because
  // the base branch advanced after the resolution push) must RE-QUEUE the same
  // row, not spawn a duplicate. Keying dedup only on ACTIVE statuses previously
  // let a `done` task slip through and the next watcher tick filed a second task
  // (observed: PR #265 had both #335 done and #336 blocked).
  const prior = await prisma.task
    .findFirst({
      where: {
        githubPrId: pr.prNumber,
        title: { startsWith: `PR #${pr.prNumber} の競合を解消` },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, completedAt: true },
    })
    .catch(() => null);

  if (prior && ACTIVE_STATUSES.includes(prior.status)) {
    // An attempt is already in flight — let it finish.
    log.debug({ prNumber: pr.prNumber, taskId: prior.id }, 'Conflict task already active');
    return { taskId: prior.id, created: false };
  }

  if (prior) {
    // prior is terminal (done/completed/failed/cancelled) but the PR still
    // conflicts. Re-queue the SAME row instead of creating a duplicate — after a
    // cooldown so a resolution push has time to be re-evaluated by GitHub.
    const finishedAt = prior.completedAt?.getTime();
    if (finishedAt != null && Date.now() - finishedAt < RECONFLICT_COOLDOWN_MS) {
      log.debug(
        { prNumber: pr.prNumber, taskId: prior.id },
        'Recent conflict task finished within cooldown; skipping re-file',
      );
      return { taskId: prior.id, created: false };
    }
    const requeued = await prisma.task
      .update({
        where: { id: prior.id },
        // Reset to a fresh-task shape so the orchestrator re-runs the workflow:
        // todo + cleared workflowStatus/completedAt, refreshed instruction, and
        // the lightweight pinning a new conflict task gets.
        data: {
          status: 'todo',
          workflowStatus: null,
          completedAt: null,
          description: instruction,
          priority: 'high',
          workflowMode: 'lightweight',
          workflowModeOverride: true,
          complexityScore: 15,
        },
        select: { id: true },
      })
      .catch((err) => {
        log.warn({ err, prNumber: pr.prNumber, taskId: prior.id }, 'Failed to re-queue conflict task');
        return null;
      });
    if (requeued) {
      log.info(
        { prNumber: pr.prNumber, taskId: requeued.id },
        'Re-queued existing conflict task (PR re-conflicted after a prior attempt)',
      );
      // created:true so the caller records a fresh conflict attempt (bounded by
      // its own MAX_CONFLICT_RETRIES) and notifies — this IS a new attempt.
      return { taskId: requeued.id, created: true };
    }
    // Update failed — fall through and try to create, so the PR still gets a task.
  }

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
