/**
 * workflow-reconciler-blocked-candidates
 *
 * The blocked-task candidate query and the per-task probes (live execution,
 * gh working directory) shared by the blocked-task heal passes
 * (workflow-reconciler-blocked.ts, workflow-reconciler-blocked-evidence.ts).
 * Not responsible for deciding what happens to a candidate.
 *
 * NOTE: Split out of workflow-reconciler-blocked.ts (over the 300-line limit)
 * when the evidence correction gained the common completion check.
 */
import { existsSync } from 'node:fs';
import { prisma } from '../../config/database';
import { ACTIVE_EXEC } from './workflow-reconciler-requeue';
import { BLOCKED_RETRY_SETTLE_MS } from './blocked-task-policy';

/** True when the task still has a live agent execution (requeue-consistent). */
export async function hasLiveExecution(taskId: number): Promise<boolean> {
  const live = await prisma.agentExecution
    .findFirst({
      where: { session: { config: { taskId } }, status: { in: ACTIVE_EXEC } },
      select: { id: true },
    })
    .catch(() => null);
  return !!live;
}

/** One blocked-task candidate row, shared by both correction and escalation passes. */
export interface BlockedCandidate {
  id: number;
  title: string;
  themeId: number | null;
  workflowStatus: string | null;
  completedAt: Date | null;
  updatedAt: Date;
  workingDirectory: string | null;
  theme: { workingDirectory: string | null } | null;
}

/**
 * Resolve a repo working directory for a `gh` live re-verification call —
 * mirrors auto-merge-candidates.ts's own cwd fallback order (task worktree,
 * then theme's stable checkout, then this process's own cwd) so
 * {@link resolveBlockedTaskEvidence}'s live check and the AutoMergeWatcher
 * never disagree about which directory to run `gh` from.
 *
 * @param t - Candidate row with the two directory hints. / cwd 候補を持つ行
 * @returns The first directory that exists on disk, or undefined if none does. / 実在する最初のディレクトリ
 */
export function resolveCwdForTask(
  t: Pick<BlockedCandidate, 'workingDirectory' | 'theme'>,
): string | undefined {
  return [t.workingDirectory, t.theme?.workingDirectory, process.cwd()].find(
    (d): d is string => !!d && existsSync(d),
  );
}

/** Blocked candidates for both passes: armed themes, settle elapsed, NO upper age bound. */
export async function findBlockedCandidates(nowMs: number): Promise<BlockedCandidate[]> {
  // Respect user stops: only heal blocked tasks in themes that are still armed.
  const armed = await prisma.themeAutoRun
    .findMany({ where: { enabled: true, status: 'running' }, select: { themeId: true } })
    .catch(() => [] as { themeId: number }[]);
  const armedThemeIds = armed.map((a) => a.themeId);
  if (armedThemeIds.length === 0) return [];

  // Unlike the retry query there is deliberately NO `gt: notOlderThan` bound:
  // an old blocked task must stay visible to correction/escalation forever —
  // aging out of the query was exactly the abandonment being fixed (task 615).
  const settleBefore = new Date(nowMs - BLOCKED_RETRY_SETTLE_MS);
  return prisma.task
    .findMany({
      where: {
        status: 'blocked',
        parentId: null,
        themeId: { in: armedThemeIds },
        updatedAt: { lt: settleBefore },
      },
      select: {
        id: true,
        title: true,
        themeId: true,
        workflowStatus: true,
        completedAt: true,
        updatedAt: true,
        workingDirectory: true,
        theme: { select: { workingDirectory: true } },
      },
    })
    .catch(() => [] as BlockedCandidate[]);
}
