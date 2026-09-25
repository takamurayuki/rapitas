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
import { readPrState } from './auto-merge-checks';
import { createLogger } from '../../config/logger';

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

const log = createLogger('workflow:blocked-task-evidence');

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
 * Re-verify a locally "successful" PR row against GitHub's live state and
 * self-heal the row when it has drifted. Local `GitHubPullRequest.state` only
 * updates via webhook sync — a `gh pr close` run from this process (no public
 * endpoint for GitHub to call back to) never reaches it, so the row can stay
 * stale `open` forever after the PR is actually closed (task 873/948). Fails
 * SOFT: a `gh` error/timeout returns the local verdict unchanged, so a
 * transient network hiccup never blocks the pre-existing "PR exists" success
 * path this module protects.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param cwd - Repo working directory for the `gh` call, or undefined to skip
 *   live verification entirely. / gh 呼び出し用の作業ディレクトリ（省略時はスキップ）
 * @param id - The `GitHubPullRequest` row id to self-heal. / 自己修復対象の行ID
 * @param prNumber - PR number to query. / PR番号
 * @param localState - The local row's state that produced a success verdict. / 元のローカル state
 * @returns The (possibly corrected) state to report as `prState`, and whether
 *   the live check still counts as success. / 実状態に基づく成否判定
 */
async function reverifyLiveState(
  prisma: PrismaClientInstance,
  cwd: string | undefined,
  id: number,
  prNumber: number,
  localState: string,
): Promise<{ isSuccess: boolean; prState: string }> {
  if (!cwd) return { isSuccess: true, prState: localState };
  const liveState = await readPrState(cwd, prNumber);
  if (liveState == null) return { isSuccess: true, prState: localState };
  if (liveState !== localState.toLowerCase()) {
    await prisma.gitHubPullRequest
      .update({ where: { id }, data: { state: liveState } })
      .catch((err) =>
        log.warn(
          { err, id, liveState },
          '[BlockedTaskEvidence] Failed to self-heal stale PR state',
        ),
      );
  }
  return { isSuccess: SUCCESS_PR_STATES.includes(liveState), prState: liveState };
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
 * When `cwd` is supplied, a success verdict from either evidence source is
 * re-checked against GitHub's LIVE state before being returned (see
 * {@link reverifyLiveState}) — the local row's state is otherwise only ever
 * webhook-synced, which never happens for a `gh pr close` issued from this
 * process itself.
 *
 * Everything else (no PR, closed-unmerged PR, unresolvable scope, DB errors)
 * is NOT success: the caller must leave the task for retry/escalation, never
 * correct it to done on ambiguity.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param taskId - Blocked task to check. / 対象タスクID
 * @param cwd - Repo working directory for live re-verification, or undefined
 *   to use the local row only (existing callers unaffected). / ライブ再検証用の作業ディレクトリ
 * @returns Evidence verdict (fail-closed). / 証拠判定（曖昧時は非成功）
 */
export async function resolveBlockedTaskEvidence(
  prisma: PrismaClientInstance,
  taskId: number,
  cwd?: string,
): Promise<BlockedTaskEvidence> {
  try {
    // Evidence 1 — task-direct PR rows. Scan ALL linked rows: a task can have
    // a closed PR superseded by a later open/merged one.
    const linked = await prisma.gitHubPullRequest
      .findMany({
        where: { linkedTaskId: taskId },
        select: { id: true, prNumber: true, state: true },
        orderBy: { updatedAt: 'desc' },
      })
      .catch(() => [] as { id: number; prNumber: number; state: string }[]);
    const successRow = linked.find((r) =>
      SUCCESS_PR_STATES.includes((r.state ?? '').toLowerCase()),
    );
    if (successRow) {
      const verified = await reverifyLiveState(
        prisma,
        cwd,
        successRow.id,
        successRow.prNumber,
        successRow.state,
      );
      return {
        isSuccess: verified.isSuccess,
        source: verified.isSuccess ? 'linked_pr' : 'none',
        prState: verified.prState,
      };
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
        if (scoped) {
          const verified = await reverifyLiveState(prisma, cwd, scoped.id, prNumber, scoped.state);
          return {
            isSuccess: verified.isSuccess,
            source: verified.isSuccess ? 'scoped_pr' : 'none',
            prState: verified.prState,
          };
        }
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
