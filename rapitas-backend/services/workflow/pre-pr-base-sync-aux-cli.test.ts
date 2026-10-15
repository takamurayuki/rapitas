/**
 * pre-pr-base-sync-aux-cli.test.ts
 *
 * Covers resolveConflictsWithAuxCli directly (task 807). This function is
 * normally injected as a stub in pre-pr-base-sync.test.ts, so the real
 * `merge --continue` git call it issues was never exercised — the ERROR-level
 * runGitCommand log this call emits on failure (before this fix) went
 * uncovered. mock.module is process-global (bun constraint): run this file
 * standalone, not concurrently with other suites mocking the same modules.
 */
import { describe, it, expect, mock } from 'bun:test';

type GitCall = { args: string[]; opts?: { skipLog?: boolean } };
const gitCalls: GitCall[] = [];
let mergeContinueShouldFail = false;

const mockRunGitCommand = mock(
  async (args: string[], _cwd: string, opts?: { skipLog?: boolean }) => {
    gitCalls.push({ args, opts });
    if (args.includes('merge') && args.includes('--continue') && mergeContinueShouldFail) {
      throw new Error('merge --continue failed: fatal: exiting because of unfinished merge');
    }
    return '';
  },
);
mock.module('../github/git-exec', () => ({ runGitCommand: mockRunGitCommand }));

mock.module('../../utils/ai-client', () => ({
  getAuxAiMode: () => 'cli',
  sendAIMessage: mock(async () =>
    Promise.resolve({
      content: '<<<RAPITAS_FILE: src/x.ts>>>\nresolved content\n<<<RAPITAS_FILE_END>>>',
      tokensUsed: 0,
    }),
  ),
}));

mock.module('fs/promises', () => ({
  readFile: mock(async () => 'conflicted content'),
  writeFile: mock(async () => {}),
}));

mock.module('../../config', () => ({
  prisma: { task: { findUnique: mock(async () => ({ title: 'Test task' })) } },
}));

const { resolveConflictsWithAuxCli } = await import('./pre-pr-base-sync');

describe('resolveConflictsWithAuxCli', () => {
  it('issues `merge --continue` with skipLog: true (own warn log covers failures — no duplicate ERROR)', async () => {
    gitCalls.length = 0;
    mergeContinueShouldFail = false;
    const ok = await resolveConflictsWithAuxCli({
      gitCwd: '/wt',
      taskId: 807,
      baseBranch: 'develop',
      conflicts: ['src/x.ts'],
    });
    expect(ok).toBe(true);
    const continueCall = gitCalls.find(
      (c) => c.args.includes('merge') && c.args.includes('--continue'),
    );
    expect(continueCall).toBeDefined();
    expect(continueCall?.opts?.skipLog).toBe(true);
  });

  it('a failing `merge --continue` is caught and returns false without throwing', async () => {
    gitCalls.length = 0;
    mergeContinueShouldFail = true;
    const ok = await resolveConflictsWithAuxCli({
      gitCwd: '/wt',
      taskId: 807,
      baseBranch: 'develop',
      conflicts: ['src/x.ts'],
    });
    expect(ok).toBe(false);
    const continueCall = gitCalls.find(
      (c) => c.args.includes('merge') && c.args.includes('--continue'),
    );
    expect(continueCall?.opts?.skipLog).toBe(true);
  });
});
