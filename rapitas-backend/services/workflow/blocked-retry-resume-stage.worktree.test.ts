/**
 * blocked-retry-resume-stage.worktree.test
 *
 * 2026-11-27: task 1549 had a worktree with two commits, but Task.workingDirectory
 * was empty — the worktree path lives on its AgentSession. loadResumeFacts read
 * only the task column, judged "no work" and reset the task to draft. The
 * session's worktree must count as the task's work.
 */
import { describe, test, expect } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { decideResumeStage, loadResumeFacts } from './blocked-retry-resume-stage';

const SESSION_DIR = 'C:\\w\\.worktrees\\task-1549-x';

function prisma(sessionPath: string | null | Error) {
  return {
    workflowTransition: { findFirst: async () => ({ fromStatus: 'verify_done' }) },
    task: { findUnique: async () => ({ workingDirectory: null, githubPrId: null }) },
    gitHubPullRequest: { findFirst: async () => null },
    agentSession: {
      findFirst: async () => {
        if (sessionPath instanceof Error) throw sessionPath;
        return sessionPath === null ? null : { worktreePath: sessionPath };
      },
    },
  } as unknown as PrismaClient;
}

describe('loadResumeFacts — worktree from the agent session', () => {
  test('uses the latest session worktree when the task has no working directory', async () => {
    const f = await loadResumeFacts(
      prisma(SESSION_DIR),
      { id: 1549, workflowStatus: 'draft' },
      { dirExists: (d) => d === SESSION_DIR, unpushed: async () => 2 },
    );
    expect(f.dirExists).toBe(true);
    expect(f.unpushedCommits).toBe(2);
    expect(decideResumeStage(f).kind).not.toBe('draft');
  });

  test('a task with no worktree anywhere still counts as no work', async () => {
    const f = await loadResumeFacts(
      prisma(null),
      { id: 1549, workflowStatus: 'draft' },
      { dirExists: () => false },
    );
    expect(f.dirExists).toBe(false);
  });

  test('an unreadable session row does not make the work look absent', async () => {
    const f = await loadResumeFacts(
      prisma(new Error('down')),
      { id: 1549, workflowStatus: 'draft' },
      { dirExists: () => true },
    );
    expect(decideResumeStage(f).kind).not.toBe('draft');
  });
});
