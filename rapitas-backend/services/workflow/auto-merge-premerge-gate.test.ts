/**
 * auto-merge-premerge-gate test
 *
 * Pins the local merge-ref ratchet: violations and execution errors must refuse
 * the merge, and the temp worktree must be removed on every path (task 1021).
 */
import { describe, it, expect } from 'bun:test';
import { runRatchetAtRef, type RatchetDeps } from './auto-merge-premerge-gate';

function makeDeps(opts: {
  stdout?: string;
  failOn?: string;
  scriptExists?: boolean;
}): RatchetDeps & { commands: string[]; removed: string[] } {
  const commands: string[] = [];
  const removed: string[] = [];
  return {
    commands,
    removed,
    exists: () => opts.scriptExists ?? true,
    removeDir: (p) => removed.push(p),
    run: async (command) => {
      commands.push(command);
      if (opts.failOn && command.includes(opts.failOn)) throw new Error(`boom: ${opts.failOn}`);
      if (command.includes('check-large-files')) return { stdout: opts.stdout ?? '{}' };
      return { stdout: '' };
    },
  };
}

describe('runRatchetAtRef', () => {
  it('passes when neither baseline_grew nor baseline_new has entries', async () => {
    const deps = makeDeps({ stdout: JSON.stringify({ baseline_grew: [], baseline_new: [] }) });
    expect((await runRatchetAtRef('/repo', 'pull/1/merge', 'pr1', deps)).verdict).toBe('pass');
  });

  it('reports a violation when a baseline file grew (the PR #707 case)', async () => {
    const deps = makeDeps({
      stdout: JSON.stringify({
        baseline_grew: [{ file: 'a/task-knowledge-extractor.ts', lines: 654, baseline: 628 }],
        baseline_new: [],
      }),
    });
    const r = await runRatchetAtRef('/repo', 'pull/1/merge', 'pr1', deps);
    expect(r.verdict).toBe('violation');
    expect('detail' in r && r.detail).toContain('654 > baseline 628');
  });

  it('reports a violation for a new over-limit file', async () => {
    const deps = makeDeps({
      stdout: JSON.stringify({ baseline_new: [{ file: 'b.ts', lines: 600 }] }),
    });
    expect((await runRatchetAtRef('/repo', 'pull/1/merge', 'pr1', deps)).verdict).toBe('violation');
  });

  it('fails closed (error) when the worktree cannot be created', async () => {
    const deps = makeDeps({ failOn: 'worktree add' });
    expect((await runRatchetAtRef('/repo', 'pull/1/merge', 'pr1', deps)).verdict).toBe('error');
  });

  it('fails closed (error) on unparsable script output', async () => {
    const deps = makeDeps({ stdout: 'not json' });
    expect((await runRatchetAtRef('/repo', 'pull/1/merge', 'pr1', deps)).verdict).toBe('error');
  });

  it('removes the temp worktree on success, violation and script error', async () => {
    const ok = makeDeps({ stdout: '{}' });
    await runRatchetAtRef('/repo', 'pull/1/merge', 'pr1', ok);
    expect(ok.commands.some((c) => c.includes('worktree remove'))).toBe(true);
    expect(ok.removed.length).toBe(1);

    const bad = makeDeps({ failOn: 'check-large-files' });
    await runRatchetAtRef('/repo', 'pull/1/merge', 'pr1', bad);
    expect(bad.commands.some((c) => c.includes('worktree remove'))).toBe(true);
    expect(bad.removed.length).toBe(1);
  });

  it('is skipped (no git calls) when the repo has no ratchet script', async () => {
    const deps = makeDeps({ scriptExists: false });
    expect((await runRatchetAtRef('/other', 'pull/1/merge', 'pr1', deps)).verdict).toBe('skipped');
    expect(deps.commands).toEqual([]);
  });
});
