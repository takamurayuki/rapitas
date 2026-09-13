/**
 * workflow-auto-commit-presave tests — the tree about to be recorded is
 * screened for protected-path tampering (hard), secret material (hard) and
 * plan scope (advisory); the local save never pushes and never duplicates.
 */
import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const actualVerifier = await import('../../services/agents/verification/automated-verifier');
let changedFixture: string[] = [];
mock.module('../../services/agents/verification/automated-verifier', () => ({
  ...actualVerifier,
  getAllChangedFiles: () => Promise.resolve(changedFixture),
}));
let planFixture: string | null = null;
const actualGate = await import('../../services/agents/verification/verification-gate');
mock.module('../../services/agents/verification/verification-gate', () => ({
  ...actualGate,
  loadPlanContent: () => Promise.resolve(planFixture),
}));
let taskFixture: Record<string, unknown> | null = { title: 't', description: '', goals: null };
mock.module('../../config', () => ({
  prisma: { task: { findUnique: () => Promise.resolve(taskFixture) } },
  getProjectRoot: () => 'C:\\x',
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

const { runPreSaveChecks, saveTaskWorkLocally } = await import('./workflow-auto-commit-presave');

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'presave-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(
    join(dir, 'src', 'leak.ts'),
    "const k = 'sk-ant-abcdefghijklmnopqrstuvwxyz0123456789';\n",
  );
  writeFileSync(join(dir, '.env'), 'TOKEN=x\n');
  writeFileSync(join(dir, '.env.example'), 'TOKEN=\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test('clean tree with no plan: tamper n/a, secret ok, scope n/a → ok', async () => {
  changedFixture = ['src/a.ts'];
  planFixture = null;
  const r = await runPreSaveChecks({ taskId: 1, gitCwd: dir, preferredBaseBranch: 'develop' });
  expect(r.ok).toBe(true);
  expect(r.summary).toBe('tamper=n/a / secret=ok / scope=n/a');
});

test('protected path outside the plan is a hard failure (no save)', async () => {
  changedFixture = ['rapitas-backend/services/agents/verification/automated-verifier.ts'];
  planFixture = '- `src/a.ts`';
  const r = await runPreSaveChecks({ taskId: 1, gitCwd: dir, preferredBaseBranch: 'develop' });
  expect(r.ok).toBe(false);
  expect(r.tamper?.ok).toBe(false);
  expect(r.summary).toContain('tamper=NG(1)');
});

test('secret material by name or content is a hard failure; .env.example is allowed', async () => {
  changedFixture = ['.env', '.env.example', 'src/leak.ts', 'src/a.ts'];
  planFixture = null;
  const r = await runPreSaveChecks({ taskId: 1, gitCwd: dir, preferredBaseBranch: 'develop' });
  expect(r.ok).toBe(false);
  expect(r.secrets.sort()).toEqual(['.env', 'src/leak.ts']);
  expect(r.summary).toContain('secret=NG(2)');
});

test('out-of-plan change is advisory only: recorded, still ok', async () => {
  changedFixture = ['src/a.ts', 'lib/other.ts'];
  planFixture = '- `src/a.ts`';
  const r = await runPreSaveChecks({ taskId: 1, gitCwd: dir, preferredBaseBranch: 'develop' });
  expect(r.ok).toBe(true);
  expect(r.scope?.ok).toBe(false);
  expect(r.summary).toContain('scope=NG(1)');
});

test('saveTaskWorkLocally: branch + local commit only, failure is reported not thrown', async () => {
  const calls: string[] = [];
  const orchestrator = {
    createBranch: async (_cwd: string, b: string) => {
      calls.push(`branch:${b}`);
    },
    createCommit: async () => {
      calls.push('commit');
      return {
        hash: 'h',
        branch: 'b',
        filesChanged: 0,
        additions: 0,
        deletions: 0,
        alreadyCommitted: true,
      };
    },
  };
  const ok = await saveTaskWorkLocally({
    orchestrator,
    gitCwd: dir,
    branchName: 'feature/x',
    message: 'm',
    targetBranch: 'develop',
  });
  expect(ok).toMatchObject({ success: true, hash: 'h', alreadyCommitted: true });
  expect(calls).toEqual(['branch:feature/x', 'commit']);
  const failing = { ...orchestrator, createCommit: async () => Promise.reject(new Error('boom')) };
  const bad = await saveTaskWorkLocally({
    orchestrator: failing,
    gitCwd: dir,
    branchName: null,
    message: 'm',
    targetBranch: 'develop',
  });
  expect(bad).toEqual({ success: false, error: 'boom' });
});
