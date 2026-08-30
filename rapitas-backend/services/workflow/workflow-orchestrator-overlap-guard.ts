/**
 * WorkflowOrchestratorOverlapGuard
 *
 * Holds the implementer while a file its task is about to touch is still
 * changing in another open auto-PR of the same theme. Owns only that hold;
 * selection-time deferral (task 573 B) and the merge barrier (573 C) stay in
 * the auto-run scheduler, and conflicts that still happen stay with the
 * auto-merge watcher.
 *
 * Why at the implementer boundary and not at selection: 46 of the 83 tasks
 * merged in the week to 2026-08-30 were lightweight — they carry no plan.md
 * when selected, so the selection gate had nothing to compare (0
 * task.deferred events in three days). By the time the implementer starts,
 * research.md or plan.md names the files: #759's research listed
 * log-health-suppressions.ts while #758's PR #533 was still open on that same
 * file, and the two PRs conflicted.
 */
import { createLogger } from '../../config/logger';
import { logCycleEvent } from '../observability';
import { getMergeBarrierMaxHoldMs } from '../scheduling/merge-barrier/merge-barrier';
import { parsePlanFiles } from '../agents/verification/scope-check';
import type { WorkflowAdvanceResult } from './workflow-agent-executor';
import type { RoleTransition, WorkflowStatus } from './workflow-types';

const log = createLogger('workflow:overlap-guard');

/**
 * Only PRs younger than this can hold the implementer. A healthy auto-PR
 * merges in ~17 min (7-day median); one still open after 6 h is parked on a
 * red CI or abandoned (#435/#467 held #755 on 2026-08-30) and waiting on it
 * only burns the ceiling.
 */
export const OVERLAP_PR_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Per-task hold start (epoch ms); deleted on release. */
const holdSince = new Map<number, number>();
/** Per-task timeout-release time; no fresh hold starts within one ceiling of it. */
const releasedAt = new Map<number, number>();

/** Kill switch: `RAPITAS_IMPLEMENT_OVERLAP_HOLD=off|0|false` disables the hold (default ON). */
export function isImplementOverlapHoldEnabled(): boolean {
  const raw = (process.env.RAPITAS_IMPLEMENT_OVERLAP_HOLD ?? '').trim().toLowerCase();
  return !(raw === 'off' || raw === '0' || raw === 'false');
}

/** Collaborators, injectable for tests. Defaults resolve lazily to stay out of the scheduler's static import graph. */
export interface OverlapGuardDeps {
  openPrs: (
    themeId: number,
  ) => Promise<Array<{ prNumber: number; linkedTaskId: number | null; createdAt: Date | null }>>;
  prFiles: (cwd: string, prNumber: number) => Promise<string[]>;
  artifact: (taskId: number, fileType: 'plan' | 'research') => Promise<string | null>;
  parseFiles: (content: string) => string[];
  overlap: (planFiles: string[], prFiles: string[]) => Promise<string[]>;
  /** Whether the PR's auto-merge is parked (exhausted) — such a PR merges only after outside help. */
  isParked: (linkedTaskId: number) => Promise<boolean>;
  now: () => number;
}

const defaultDeps: OverlapGuardDeps = {
  openPrs: async (themeId) => {
    const { prisma } = await import('../../config');
    const { getOpenAutoPrsForTheme } = await import('./auto-run/open-pr-files-cache');
    return getOpenAutoPrsForTheme(prisma, themeId);
  },
  prFiles: async (cwd, prNumber) => {
    const { getPrChangedFiles } = await import('./auto-run/open-pr-files-cache');
    return getPrChangedFiles(cwd, prNumber);
  },
  artifact: async (taskId, fileType) => {
    const { readWorkflowFile } = await import('./workflow-file-utils');
    return readWorkflowFile(taskId, fileType);
  },
  parseFiles: parsePlanFiles,
  overlap: async (planFiles, prFiles) => {
    const { overlappingFiles } = await import('./auto-run/auto-run-selection');
    return overlappingFiles(planFiles, prFiles);
  },
  isParked: async (linkedTaskId) => {
    const { prisma } = await import('../../config');
    const latest = await prisma.workflowTransition.findFirst({
      where: { taskId: linkedTaskId, cause: { in: ['auto_merged', 'auto_merge_exhausted'] } },
      orderBy: { createdAt: 'desc' },
      select: { cause: true },
    });
    return latest?.cause === 'auto_merge_exhausted';
  },
  now: () => Date.now(),
};

/** The slice of the resolved task the guard needs. */
export interface OverlapGuardTask {
  themeId: number | null;
  theme: { workingDirectory: string | null } | null;
}

export type OverlapGuardOutcome = { done: true; result: WorkflowAdvanceResult } | { done: false };

/**
 * Hold the implementer while the files its research/plan names are still
 * changing in another open auto-PR of the theme.
 *
 * Returns `{ done: true, result }` with `skipped: true` — the runner re-queues
 * the item without failing it — while the hold is active. Returns
 * `{ done: false }` when the role is not the implementer, nothing overlaps,
 * the hold ceiling (MERGE_BARRIER_MAX_HOLD_MS, 30 min) has passed, or any
 * lookup fails: the guard always fails open.
 *
 * @param taskId - Task about to run its implementer. / 実装フェーズに入るタスク
 * @param transition - Resolved role transition for the current status. / 現ステータスの遷移
 * @param task - Theme id and working directory of the task. / テーマとワークディレクトリ
 * @param currentStatus - Workflow status the hold reports back. / 保留時に返すステータス
 * @param deps - Test overrides. / テスト用差し替え
 * @returns Early-return result while held, else continue. / 保留中は早期終了結果
 */
export async function guardImplementOverlap(
  taskId: number,
  transition: RoleTransition,
  task: OverlapGuardTask,
  currentStatus: WorkflowStatus,
  deps: Partial<OverlapGuardDeps> = {},
): Promise<OverlapGuardOutcome> {
  if (transition.role !== 'implementer' || !isImplementOverlapHoldEnabled()) return { done: false };
  const themeId = task.themeId;
  const cwd = task.theme?.workingDirectory;
  if (themeId == null || !cwd) return { done: false };
  const d: OverlapGuardDeps = { ...defaultDeps, ...deps };
  try {
    // The task's own PR (re-runs, ci_repair) is never a reason to wait, and
    // neither is a stale one — only a PR fresh enough to merge soon holds us.
    const freshSince = d.now() - OVERLAP_PR_MAX_AGE_MS;
    const candidates = (await d.openPrs(themeId)).filter(
      (pr) =>
        pr.linkedTaskId !== taskId && pr.createdAt != null && pr.createdAt.getTime() >= freshSince,
    );
    // An exhausted-parked PR only merges after outside help — often exactly
    // the held task's own job (#764 split verify-self-repair.ts to unblock
    // PR #537, and the guard held #764 waiting for #537: a circular wait).
    const openPrs: typeof candidates = [];
    for (const pr of candidates) {
      if (pr.linkedTaskId != null && (await d.isParked(pr.linkedTaskId))) continue;
      openPrs.push(pr);
    }
    if (openPrs.length === 0) return release(taskId, 'no_open_pr', d.now());
    const artifact = (await d.artifact(taskId, 'plan')) ?? (await d.artifact(taskId, 'research'));
    const planFiles = artifact ? d.parseFiles(artifact) : [];
    if (planFiles.length === 0) return release(taskId, 'no_files', d.now());
    const hits: Array<{ prNumber: number; files: string[] }> = [];
    for (const pr of openPrs) {
      const files = await d.overlap(planFiles, await d.prFiles(cwd, pr.prNumber));
      if (files.length > 0) hits.push({ prNumber: pr.prNumber, files });
    }
    if (hits.length === 0) return release(taskId, 'no_overlap', d.now());

    const now = d.now();
    const maxHoldMs = getMergeBarrierMaxHoldMs();
    const since = holdSince.get(taskId);
    const prs = hits.map((h) => h.prNumber);
    if (since !== undefined && now - since >= maxHoldMs) {
      // Deadlock release: a PR stuck open (red CI, manual review) must not
      // pin the theme forever. Remember the release so the next tick does
      // not immediately start a fresh hold on the same PR set.
      holdSince.delete(taskId);
      releasedAt.set(taskId, now);
      logCycleEvent('task.implement_overlap_released', {
        task: taskId,
        theme: themeId,
        reason: 'timeout',
        holdMs: now - since,
        prs,
        msg: 'implementer overlap hold timed out — proceeding despite the open auto-PR',
      });
      log.warn(
        { taskId, prs, holdMs: now - since },
        '[overlap-guard] hold ceiling passed — proceeding',
      );
      return { done: false };
    }
    if (since === undefined) {
      const rel = releasedAt.get(taskId);
      if (rel !== undefined && now - rel < maxHoldMs) return { done: false };
      holdSince.set(taskId, now);
      const files = hits.flatMap((h) => h.files);
      logCycleEvent('task.implement_overlap_hold', {
        task: taskId,
        theme: themeId,
        prs,
        files: files.slice(0, 20),
        msg: 'implementer held — its files are still changing in an open auto-PR',
      });
      log.info({ taskId, prs, files: files.slice(0, 5) }, '[overlap-guard] holding implementer');
    }
    const summary = hits.map((h) => `#${h.prNumber}: ${h.files.slice(0, 3).join(', ')}`).join('; ');
    return {
      done: true,
      result: {
        success: true,
        role: transition.role,
        status: currentStatus,
        skipped: true,
        held: `open auto-PR still changes ${summary}`,
      },
    };
  } catch (err) {
    log.warn({ err, taskId }, '[overlap-guard] lookup failed — proceeding (fail open)');
    return { done: false };
  }
}

function release(taskId: number, reason: string, now: number): OverlapGuardOutcome {
  const since = holdSince.get(taskId);
  if (since !== undefined) {
    holdSince.delete(taskId);
    logCycleEvent('task.implement_overlap_released', {
      task: taskId,
      reason,
      holdMs: now - since,
      msg: 'implementer overlap hold released',
    });
    log.info({ taskId, reason, holdMs: now - since }, '[overlap-guard] hold released');
  }
  return { done: false };
}

/** Clears hold bookkeeping between tests. */
export function resetOverlapGuardState(): void {
  holdSince.clear();
  releasedAt.clear();
}
