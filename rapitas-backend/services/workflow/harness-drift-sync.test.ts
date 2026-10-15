/**
 * harness-drift-sync tests — pre-gate base sync only on harness drift, only
 * on a clean worktree, and never a pass/fail decision.
 */
import { describe, expect, mock, test } from 'bun:test';
import { syncHarnessIfDrifted, type HarnessDriftSyncDeps } from './harness-drift-sync';

const CFG = {
  start: 'cd rapitas-frontend && npm run dev:runtime -- -p {port}',
  url: 'http://127.0.0.1:{port}',
  healthPath: '/',
  readyTimeoutMs: 1000,
  checkPaths: ['/'],
};

function deps(overrides: Partial<HarnessDriftSyncDeps> = {}) {
  const sync = mock(() =>
    Promise.resolve({ status: 'clean' as const, changedFiles: 3, conflicts: [], detail: '' }),
  );
  const d: HarnessDriftSyncDeps = {
    resolveConfig: async () => ({ config: CFG }),
    themeDir: async () => 'C:/main',
    detectDrift: async () => 'drift',
    hasScript: async () => true,
    runGit: async () => '',
    sync,
    ...overrides,
  };
  return { d, sync };
}

describe('syncHarnessIfDrifted', () => {
  test('no runtime config or no drift → null, base sync untouched', async () => {
    const a = deps({ resolveConfig: async () => null });
    expect(
      await syncHarnessIfDrifted({ taskId: 1, gitCwd: 'C:/wt', baseBranch: 'develop', deps: a.d }),
    ).toBeNull();
    const b = deps({ detectDrift: async () => null });
    expect(
      await syncHarnessIfDrifted({ taskId: 1, gitCwd: 'C:/wt', baseBranch: 'develop', deps: b.d }),
    ).toBeNull();
    expect(a.sync).not.toHaveBeenCalled();
    expect(b.sync).not.toHaveBeenCalled();
  });

  test('drift on a clean worktree → base sync runs and the harness is re-checked', async () => {
    const { d, sync } = deps();
    const r = await syncHarnessIfDrifted({
      taskId: 901,
      gitCwd: 'C:/wt',
      baseBranch: 'develop',
      sessionId: 7,
      deps: d,
    });
    expect(sync).toHaveBeenCalledWith({
      gitCwd: 'C:/wt',
      baseBranch: 'develop',
      taskId: 901,
      sessionId: 7,
    });
    expect(r?.sync.status).toBe('clean');
    expect(r?.harnessPresent).toBe(true);
    expect(r?.reason).toBe('drift');
  });

  test('drift on a dirty worktree → not attempted (the gate holds as unverified)', async () => {
    const { d, sync } = deps({ runGit: async () => ' M rapitas-backend/x.ts\n' });
    const r = await syncHarnessIfDrifted({
      taskId: 901,
      gitCwd: 'C:/wt',
      baseBranch: 'develop',
      deps: d,
    });
    expect(sync).not.toHaveBeenCalled();
    expect(r?.sync.status).toBe('not_attempted');
    expect(r?.harnessPresent).toBe(false);
  });

  test('unresolved conflicts are reported, never turned into a pass', async () => {
    const { d } = deps({
      sync: async () => ({
        status: 'conflict_unresolved' as const,
        changedFiles: 0,
        conflicts: ['a.ts'],
        detail: 'x',
      }),
      hasScript: async () => false,
    });
    const r = await syncHarnessIfDrifted({
      taskId: 901,
      gitCwd: 'C:/wt',
      baseBranch: 'develop',
      deps: d,
    });
    expect(r?.sync.status).toBe('conflict_unresolved');
    expect(r?.harnessPresent).toBe(false);
  });
});
