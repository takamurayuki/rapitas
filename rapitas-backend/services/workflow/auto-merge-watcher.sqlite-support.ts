/** SQLite受入試験用。watcherの判断・完了・記録は実関数、GitHub応答は固定する。 */
import { mock } from 'bun:test';
import type { Candidate } from './auto-merge-candidates';

mock.module('./auto-merge-checks', () => ({
  blockingChecks: () => new Set(['test']),
  evaluateAutoMergeChecks: () => 'pass',
  readPrChecks: async () => [{ name: 'test', bucket: 'pass' }],
  readMergeState: async () => 'CLEAN',
  readIsDraft: async () => false,
  readHeadSha: async () => 'sha',
  readPrState: async () => 'merged',
  updatePrBranch: async () => true,
  ghPath: () => 'gh',
}));
mock.module('./auto-merge-premerge-gate', () => ({
  evaluatePreMergeGate: async () => ({ ok: true }),
  RATCHET_CHECK_NAME: 'ratchet',
  runRatchetAtRef: async () => ({ ok: true }),
}));
mock.module('./verifier-completion-check', () => ({
  verifierConfirmedForCompletion: async () => true,
}));
mock.module('../github/pr-link', () => ({
  resolveIntegrationId: async () => null,
  linkAutoCreatedPr: async () => null,
}));
mock.module('./auto-merge-notify', () => ({ notify: async () => {} }));
export const merge = mock(async () => ({ success: true, mergeStrategy: 'squash' as const }));
mock.module('../agents/orchestrator/git-operations/pr/branch-pr-ops', () => ({
  mergePullRequest: merge,
}));

/** 実watcherの候補処理を呼ぶ。完了CASとdeliverable記録をモックしない。 */
export async function processGreenCandidate(taskId: number): Promise<void> {
  const { AutoMergeWatcher } = await import('./auto-merge-watcher');
  const watcher = AutoMergeWatcher.getInstance() as unknown as {
    process(candidate: Candidate, blocking: Set<string>): Promise<void>;
  };
  await watcher.process(
    {
      taskId,
      taskTitle: 'A',
      prNumber: 7,
      baseBranch: 'develop',
      cwd: '/test',
      threshold: 0,
      completedAt: null,
      mode: 'merge',
    },
    new Set(['test']),
  );
}
