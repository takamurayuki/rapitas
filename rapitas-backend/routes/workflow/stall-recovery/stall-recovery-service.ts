/**
 * stall-recovery-service
 *
 * On-demand stall scan + user-approved recovery execution for the accessible
 * stall-recovery UI. Deliberately independent of self-incident-watcher's 5-min
 * throttle (key presses need immediate answers) while sharing the SAME
 * detection primitives (detectStagnation / STAGNATION_THRESHOLD_MS) so the two
 * paths can never disagree about what counts as stalled. Detection here files
 * NO concerns — it only answers the caller.
 */
import { existsSync, unlinkSync } from 'fs';
import { resolve, sep } from 'path';
import { prisma, getProjectRoot } from '../../../config';
import { createLogger } from '../../../config/logger';
import {
  detectStagnation,
  STAGNATION_THRESHOLD_MS,
  REPEAT_LOOP_WINDOW_MS,
} from '../../../services/workflow/incident-signature-detectors';
import { gatherTaskState } from '../../../services/workflow/self-incident-evidence';
import {
  inferStallCause,
  summarizeStall,
  type StallVerbosity,
} from '../../../services/workflow/stall-summary';
import { WorkflowQueueService } from '../../../services/workflow/workflow-queue';
import { handleResumeCompletion } from '../../../services/agents/orchestrator/resume-completion';
import type {
  RecoverResult,
  StallCheckResponse,
  StalledTaskReport,
  StallRecoveryAction,
} from './stall-recovery.types';

const log = createLogger('stall-recovery');

/** Same terminal set as incident-signature-detectors (kept for DB pre-filter). */
const TERMINAL_TASK_STATUSES = ['done', 'cancelled', 'archived', 'completed'];

/** Execution statuses considered live when interrupting a stuck task. */
const LIVE_EXECUTION_STATUSES = ['running', 'pending', 'waiting_for_input'];

/**
 * Per-scan cap. Key-press latency guard: each surviving candidate costs ~5
 * queries in gatherTaskState, so the DB pre-filter + this cap bound the worst
 * case instead of the watcher's 200-task sweep.
 */
const MAX_SCAN_CANDIDATES = 25;

/** Resume timeout passed to handleResumeCompletion (same as the resume route). */
const RESUME_TIMEOUT_MS = 900_000;

/**
 * Whether destructive recovery (git lock deletion) is enabled. Default OFF —
 * the UI still PRESENTS the option, but execution is refused without the flag.
 *
 * @param env - Env source (injectable for tests). / 環境変数ソース
 * @returns true when the flag is explicitly enabled. / フラグ有効時のみtrue
 */
export function isDestructiveRecoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.RAPITAS_ENABLE_STALL_DESTRUCTIVE_RECOVERY ?? '').toLowerCase();
  return value === '1' || value === 'true';
}

/** Case handling matches the OS: Windows paths compare case-insensitively. */
function normalizeForCompare(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/** True when `child` equals or lies under `parent` (both already resolved). */
function isSameOrUnder(child: string, parent: string): boolean {
  const c = normalizeForCompare(child);
  const p = normalizeForCompare(parent);
  return c === p || c.startsWith(p + sep);
}

/**
 * Validates the git-lock deletion target for one worktree. The ONLY path this
 * may ever produce is `<worktreePath>/.git/index.lock`, and only when the
 * worktree is neither the primary checkout itself nor an ancestor of it —
 * the structural guard against the known primary-checkout clobber incidents.
 *
 * NOTE: In a linked worktree `.git` is a FILE (gitdir pointer), so the lock
 * actually lives under the shared gitdir OUTSIDE worktreePath; deleting there
 * is deliberately out of scope — the guard restricts targets to worktreePath.
 *
 * @param worktreePath - The task's recorded worktree path. / 対象worktree
 * @param projectRoot - Primary checkout root. / プライマリチェックアウト
 * @returns The validated lock path, or a rejection reason. / 許可パスまたは拒否理由
 */
export function resolveGitLockTarget(
  worktreePath: string,
  projectRoot: string,
): { ok: true; lockPath: string } | { ok: false; reason: string } {
  const normalizedWorktree = resolve(worktreePath);
  const normalizedRoot = resolve(projectRoot);

  if (normalizeForCompare(normalizedWorktree) === normalizeForCompare(normalizedRoot)) {
    return { ok: false, reason: 'プライマリチェックアウトを対象とする破壊的操作は拒否されました' };
  }
  if (isSameOrUnder(normalizedRoot, normalizedWorktree)) {
    return {
      ok: false,
      reason: 'プライマリチェックアウトを含むパスへの破壊的操作は拒否されました',
    };
  }
  const lockPath = resolve(normalizedWorktree, '.git', 'index.lock');
  if (!isSameOrUnder(lockPath, normalizedWorktree)) {
    return { ok: false, reason: '対象パスがworktree配下から外れているため拒否されました' };
  }
  return { ok: true, lockPath };
}

/**
 * Scans for currently stalled tasks on demand (no throttle, no concern filing).
 * Cheap DB pre-filter first (non-terminal + updatedAt older than threshold —
 * a fresher updatedAt can never be stagnant because the detector's activity
 * time is max(updatedAt, latest transition)), then full evidence gathering on
 * the survivors only.
 *
 * @param nowMs - Current time (ms); injectable for tests. / 現在時刻
 * @param verbosity - Narration detail level. / 読み上げ詳細度
 * @returns Stalled task reports, most recently active first. / 停滞タスク一覧
 */
export async function scanStalledTasks(
  nowMs: number = Date.now(),
  verbosity: StallVerbosity = 'standard',
): Promise<StallCheckResponse> {
  const cutoff = new Date(nowMs - STAGNATION_THRESHOLD_MS);
  const candidates = await prisma.task
    .findMany({
      where: {
        parentId: null,
        status: { notIn: TERMINAL_TASK_STATUSES },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, title: true, status: true, workflowStatus: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_SCAN_CANDIDATES,
    })
    .catch(
      () =>
        [] as {
          id: number;
          title: string;
          status: string;
          workflowStatus: string | null;
          updatedAt: Date;
        }[],
    );

  const tasks: StalledTaskReport[] = [];
  for (const task of candidates) {
    try {
      const state = await gatherTaskState(task, nowMs, REPEAT_LOOP_WINDOW_MS);
      const stagnation = detectStagnation({
        taskStatus: task.status,
        workflowStatus: task.workflowStatus,
        lastActivityAtMs: Math.max(state.taskUpdatedAtMs, state.latestTransitionAtMs ?? 0),
        hasLiveExecution: state.hasLiveExecution,
        hasAnyExecution: state.hasAnyExecution,
        hasActiveQueueItem: state.hasActiveQueueItem,
        nowMs,
      });
      if (!stagnation) continue;

      const { cause, suggestedActions } = inferStallCause(state, task.workflowStatus);
      tasks.push({
        taskId: task.id,
        title: task.title,
        staleMinutes: Math.round(stagnation.staleMs / 60_000),
        cause,
        narration: summarizeStall({ state, staleMs: stagnation.staleMs, cause, verbosity }),
        suggestedActions,
      });
    } catch (err) {
      // One broken task must not hide the others from the panel.
      log.warn({ err, taskId: task.id }, '[stall-recovery] scan of one task failed — continuing');
    }
  }
  return { tasks, checkedAt: new Date(nowMs).toISOString() };
}

/** Resumes the task's latest interrupted execution (mirrors the resume route). */
async function recoverByResume(taskId: number): Promise<RecoverResult> {
  const execution = await prisma.agentExecution.findFirst({
    where: { session: { config: { taskId } }, status: 'interrupted' },
    orderBy: { id: 'desc' },
    include: {
      session: {
        include: {
          config: {
            include: {
              task: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  theme: { select: { name: true, workingDirectory: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!execution) {
    return { success: false, action: 'resume', message: '再開できる中断済み実行が見つかりません' };
  }
  const task = execution.session.config?.task;
  if (!task) {
    return { success: false, action: 'resume', message: '実行に対応するタスクが見つかりません' };
  }
  const workingDirectory = task.theme?.workingDirectory;
  if (!workingDirectory) {
    return {
      success: false,
      action: 'resume',
      message: 'テーマに作業ディレクトリが設定されていないため再開できません',
    };
  }
  await prisma.task.update({
    where: { id: task.id },
    data: { status: 'in-progress', startedAt: new Date() },
  });
  // Fire-and-forget like the manual resume route — completion state is
  // handled by handleResumeCompletion.
  handleResumeCompletion(
    execution.id,
    { sessionId: execution.sessionId, session: { config: execution.session.config } },
    task,
    workingDirectory,
    RESUME_TIMEOUT_MS,
  );
  return {
    success: true,
    action: 'resume',
    message: `中断された実行 #${execution.id} を再開しています`,
  };
}

/** Marks stuck executions/sessions interrupted and reverts the task to todo. */
async function recoverByInterrupt(taskId: number): Promise<RecoverResult> {
  const updated = await prisma.agentExecution.updateMany({
    where: { session: { config: { taskId } }, status: { in: LIVE_EXECUTION_STATUSES } },
    data: {
      status: 'interrupted',
      completedAt: new Date(),
      errorMessage: '停滞リカバリーUIからの手動中断',
    },
  });
  const sessions = await prisma.agentSession.findMany({
    where: { config: { taskId }, status: { in: ['active', 'running', 'pending'] } },
    select: { id: true },
  });
  let finalizedSessions = 0;
  for (const session of sessions) {
    const live = await prisma.agentExecution.count({
      where: { sessionId: session.id, status: { in: LIVE_EXECUTION_STATUSES } },
    });
    if (live === 0) {
      await prisma.agentSession.update({
        where: { id: session.id },
        data: { status: 'interrupted', lastActivityAt: new Date() },
      });
      finalizedSessions++;
    }
  }
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
  if (task?.status === 'in-progress') {
    await prisma.task.update({ where: { id: taskId }, data: { status: 'todo' } });
  }
  return {
    success: true,
    action: 'interrupt',
    message: `実行${updated.count}件を中断し、セッション${finalizedSessions}件を整理しました`,
  };
}

/** Re-enqueues the task into the workflow queue for the auto-run pipeline. */
async function recoverByRequeue(taskId: number): Promise<RecoverResult> {
  try {
    await WorkflowQueueService.getInstance().enqueue({ taskId });
    return {
      success: true,
      action: 'requeue',
      message: 'タスクをワークフローキューに再投入しました',
    };
  } catch (err) {
    return {
      success: false,
      action: 'requeue',
      message: err instanceof Error ? err.message : '再キューに失敗しました',
    };
  }
}

/** Deletes the worktree-local git index.lock under the double gate. */
async function recoverByClearGitLock(taskId: number): Promise<RecoverResult> {
  if (!isDestructiveRecoveryEnabled()) {
    return {
      success: false,
      action: 'clear_git_lock',
      message: '破壊的リカバリーは無効です（RAPITAS_ENABLE_STALL_DESTRUCTIVE_RECOVERY が未設定）',
    };
  }
  const session = await prisma.agentSession.findFirst({
    where: { config: { taskId }, worktreePath: { not: null } },
    orderBy: { updatedAt: 'desc' },
    select: { worktreePath: true },
  });
  if (!session?.worktreePath) {
    return {
      success: false,
      action: 'clear_git_lock',
      message: 'このタスクに紐づくworktreeが見つかりません',
    };
  }
  const target = resolveGitLockTarget(session.worktreePath, getProjectRoot());
  if (!target.ok) {
    log.warn(
      { taskId, worktreePath: session.worktreePath },
      '[stall-recovery] git lock deletion rejected by path guard',
    );
    return { success: false, action: 'clear_git_lock', message: target.reason };
  }
  if (!existsSync(target.lockPath)) {
    return {
      success: false,
      action: 'clear_git_lock',
      message: 'index.lock は存在しません（削除は不要です）',
    };
  }
  unlinkSync(target.lockPath);
  log.info({ taskId, lockPath: target.lockPath }, '[stall-recovery] deleted git index.lock');
  return {
    success: true,
    action: 'clear_git_lock',
    message: 'worktree の index.lock を削除しました',
  };
}

/**
 * Executes ONE user-approved recovery action. Called only after the user
 * confirmed with Space in the panel — no caller may invoke this automatically.
 *
 * @param taskId - Target task id. / 対象タスクID
 * @param action - Approved recovery action. / 承認済みアクション
 * @returns Outcome with a narratable message. / 実行結果
 */
export async function recoverStalledTask(
  taskId: number,
  action: StallRecoveryAction,
): Promise<RecoverResult> {
  switch (action) {
    case 'resume':
      return recoverByResume(taskId);
    case 'interrupt':
      return recoverByInterrupt(taskId);
    case 'requeue':
      return recoverByRequeue(taskId);
    case 'clear_git_lock':
      return recoverByClearGitLock(taskId);
  }
}
