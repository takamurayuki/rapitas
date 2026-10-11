/**
 * adversarial-diff-review.base-satisfied.test
 *
 * Task 1196: a jury FAIL about a plan item that already exists on the base ref
 * must not be bounced again; the same FAIL for an item present in neither the
 * base nor the diff must stay a FAIL. Real throwaway git repo; AI/db mocked.
 */
import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let repo = '';
let baseSha = '';

const getDiff = mock(() =>
  Promise.resolve([
    { filename: 'src/other.ts', status: 'M', additions: 1, deletions: 0, patch: '+x' },
  ]),
);
const resolveBaseRef = mock(() => Promise.resolve(baseSha));
let reasons: string[] = [];
const sendAIMessage = mock(() =>
  Promise.resolve({ content: JSON.stringify({ verdict: 'fail', severity: 80, reasons }) }),
);

mock.module('../orchestrator/git-operations/core/diff-structured', () => ({
  getDiff,
  resolveBaseRef,
}));
mock.module('../../../utils/ai-client', () => ({ sendAIMessage, getAuxAiMode: () => 'api' }));
mock.module('../../workflow/workflow-file-utils', () => ({
  resolveWorkflowDir: mock(() => Promise.resolve({ dir: '/wf/1' })),
  readWorkflowFile: mock(() => Promise.resolve('plan content')),
}));
mock.module('../../memory/timeline', () => ({
  appendEvent: mock(() => Promise.resolve({ id: 1 })),
}));
mock.module('../../../config/database', () => ({
  prisma: {
    agentExecution: { findFirst: mock(() => Promise.resolve(null)) },
    agentExecutionConfig: { findUnique: mock(() => Promise.resolve(null)) },
    task: { findUnique: mock(() => Promise.resolve({ title: 'Task', acceptanceCriteria: null })) },
  },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { reviewDiffAdversarially, resetJurorHealth } = await import('./adversarial-diff-review');

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'base-satisfied-review-'));
  git(['init', '-q']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 't']);
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'aux-cli-ownership.ts'), 'if (!resolved) return false;\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  baseSha = git(['rev-parse', 'HEAD']);
}, 60_000);

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('reviewDiffAdversarially — plan item already on base', () => {
  it('does not repeat the finding when the item already exists on the base ref', async () => {
    resetJurorHealth();
    reasons = [
      '計画の中核 `src/aux-cli-ownership.ts` の `if (!resolved) return false;` が差分に無い',
    ];
    const r = await reviewDiffAdversarially({ taskId: 1196, worktreePath: repo });
    expect(r.verdict).toBe('pass');
    expect(r.reasons).toEqual([]);
    expect(r.baseSatisfied?.[0]?.path).toBe('src/aux-cli-ownership.ts');
  });

  it('stays FAIL when the item is on neither the base nor the diff', async () => {
    resetJurorHealth();
    reasons = ['計画の中核 `src/aux-cli-ownership.ts` の `guardOwner(` が差分に無い'];
    const r = await reviewDiffAdversarially({ taskId: 1196, worktreePath: repo });
    expect(r.verdict).toBe('fail');
    expect(r.reasons).toEqual(reasons);
    expect(r.baseSatisfied).toBeUndefined();
  });
});
