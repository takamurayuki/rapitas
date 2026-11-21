/**
 * workflow-cli-executor-worktree.investigation.test
 *
 * 2026-11-21: investigation roles read the theme's primary checkout, which for
 * trendline sat on a July master while every implementation was cut from
 * origin/develop. They must read the base snapshot when there is no worktree.
 */
import { describe, expect, mock, test } from 'bun:test';

const snapshotCalls: Array<[string, string | null]> = [];
mock.module('./investigation-base-snapshot', () => ({
  resolveInvestigationWorkDir: async (dir: string, base: string | null) => {
    snapshotCalls.push([dir, base]);
    return 'C:/proj/.worktrees/_base-abc';
  },
}));
mock.module('../task/task-resolver', () => ({
  resolvePreferredBaseBranch: async () => 'develop',
  resolveTaskTitle: async () => null,
  resolveTaskWithTheme: async () => null,
}));
let prior: { worktreePath: string; branchName: string } | null = null;
mock.module('../agents/agent-session-resolver', () => ({
  resolveLatestSessionWorktree: async () => prior,
}));
mock.module('../agents/orchestrator/git-operations/worktree/worktree-guard', () => ({
  isPrimaryWorkTree: async () => false,
}));

const { resolveExecutionWorkdir } = await import('./workflow-cli-executor-worktree');

const taskWithTheme = { theme: { workingDirectory: 'C:/proj' } } as Parameters<
  typeof resolveExecutionWorkdir
>[0]['taskWithTheme'];

describe('investigation roles without a task worktree', () => {
  test.each(['researcher', 'planner'])('%s reads the base snapshot', async (role) => {
    snapshotCalls.length = 0;
    prior = null;
    const out = await resolveExecutionWorkdir({
      taskId: 7,
      transition: { role } as Parameters<typeof resolveExecutionWorkdir>[0]['transition'],
      orchestrator: {} as Parameters<typeof resolveExecutionWorkdir>[0]['orchestrator'],
      taskWithTheme,
    });
    expect(out.effectiveWorkDir).toBe('C:/proj/.worktrees/_base-abc');
    expect(snapshotCalls).toEqual([['C:/proj', 'develop']]);
  });
});
