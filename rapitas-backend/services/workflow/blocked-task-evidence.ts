/**
 * blocked-task-evidence
 *
 * Success-evidence resolution for blocked tasks (task 615): decides from
 * EXISTING DB rows only whether a blocked task actually succeeded (its work
 * was pushed and a PR exists), so the reconciler can correct it to done
 * instead of blindly re-running it and opening a duplicate PR.
 * Not responsible for mutating any state — pure reads, fail-closed.
 */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { findScopedOpenPr, resolveIntegrationIdForTask } from '../github/pr-lookup';

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

/** PR states that prove the implementation landed (pushed + PR opened/merged). */
const SUCCESS_PR_STATES = ['open', 'merged'];

/** Outcome of the success-evidence check for one blocked task. */
export interface BlockedTaskEvidence {
  /** True only when a decisive success proof exists. Ambiguity = false. */
  isSuccess: boolean;
  /** Which evidence decided: linked PR row, scoped prNumber lookup, or none. */
  source: 'linked_pr' | 'scoped_pr' | 'none';
  /** State of the PR row that decided (when one was found). / 判定に使ったPRのstate */
  prState?: string;
}

/**
 * Resolve success evidence for a blocked task from existing tables.
 *
 * Evidence order (first hit wins):
 *  1. A GitHubPullRequest row with linkedTaskId === taskId and state
 *     open/merged — task-direct, immune to cross-repo prNumber collisions.
 *  2. task.githubPrId (a PR NUMBER, unique only per repo) resolved through
 *     resolveIntegrationIdForTask + findScopedOpenPr (open only). A null
 *     integrationId fails closed — guessing risks another repo's PR (task 596).
 *
 * Everything else (no PR, closed-unmerged PR, unresolvable scope, DB errors)
 * is NOT success: the caller must leave the task for retry/escalation, never
 * correct it to done on ambiguity.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param taskId - Blocked task to check. / 対象タスクID
 * @returns Evidence verdict (fail-closed). / 証拠判定（曖昧時は非成功）
 */
export async function resolveBlockedTaskEvidence(
  prisma: PrismaClientInstance,
  taskId: number,
): Promise<BlockedTaskEvidence> {
  try {
    // Evidence 1 — task-direct PR rows. Scan ALL linked rows: a task can have
    // a closed PR superseded by a later open/merged one.
    const linked = await prisma.gitHubPullRequest
      .findMany({
        where: { linkedTaskId: taskId },
        select: { state: true },
        orderBy: { updatedAt: 'desc' },
      })
      .catch(() => [] as { state: string }[]);
    const successRow = linked.find((r) =>
      SUCCESS_PR_STATES.includes((r.state ?? '').toLowerCase()),
    );
    if (successRow) {
      return { isSuccess: true, source: 'linked_pr', prState: successRow.state };
    }

    // Evidence 2 — prNumber fallback, repo-scoped only.
    const task = await prisma.task
      .findUnique({ where: { id: taskId }, select: { githubPrId: true } })
      .catch(() => null);
    const prNumber = task?.githubPrId;
    if (typeof prNumber === 'number' && prNumber > 0) {
      const integrationId = await resolveIntegrationIdForTask(prisma, taskId).catch(() => null);
      if (integrationId != null) {
        const scoped = await findScopedOpenPr(prisma, integrationId, prNumber, {
          id: true,
          state: true,
        }).catch(() => null);
        if (scoped) return { isSuccess: true, source: 'scoped_pr', prState: scoped.state };
      }
    }

    // Ambiguous: report the newest linked state (e.g. 'closed') for observability.
    const ambiguousState = linked[0]?.state;
    return {
      isSuccess: false,
      source: 'none',
      ...(ambiguousState ? { prState: ambiguousState } : {}),
    };
  } catch {
    return { isSuccess: false, source: 'none' };
  }
}
