/**
 * blocked-retry-fixtures
 *
 * Prisma-double pieces the blocked auto-retry's resume decision reads (task 1563): the
 * transition INTO blocked with an allow-listed cause, a task with no PR on record, and no
 * agent-session worktree.
 * Shared so large legacy reconciler tests need one line each instead of inline fixtures.
 * NOT a stop-guard double: tests that need a stopped / cancelled task build their own.
 */

/** `workflowTransition.findFirst` that answers the blocked-entry lookup with a resumable cause. */
export function blockedEntryLookup(args?: { where?: { toStatus?: string } }): Promise<unknown> {
  return Promise.resolve(
    args?.where?.toStatus === 'blocked'
      ? { fromStatus: null, cause: 'auto_run_hang_backstop' }
      : null,
  );
}

/** `gitHubPullRequest` model with no PR on record (absent, not unreadable). */
export const noPullRequest = { findFirst: () => Promise.resolve(null) };

/** `agentSession` model with no session worktree on record (absent, not unreadable). */
export const noAgentSession = { findFirst: () => Promise.resolve(null) };

/** The pieces of a Prisma double that {@link installResumeFixtures} writes into. */
interface ResumeFixtureTarget {
  workflowTransition: {
    findFirst: { mockReset(): { mockImplementation(fn: never): unknown } };
  };
  [model: string]: unknown;
}

/**
 * Install the resume-decision reads on a Prisma double: a resumable blocked entry and a task
 * with no PR. Call it from beforeEach (it resets `workflowTransition.findFirst`).
 *
 * @param db - The test's Prisma double. / テストのPrismaモック
 */
export function installResumeFixtures(db: ResumeFixtureTarget): void {
  db.gitHubPullRequest = noPullRequest;
  // The resume facts also look up the session worktree; keep a test's own double if it has one.
  db.agentSession ??= noAgentSession;
  db.workflowTransition.findFirst.mockReset().mockImplementation(blockedEntryLookup as never);
}
