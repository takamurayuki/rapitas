/**
 * auto-merge-premerge-gate test
 *
 * Pins the local merge-ref ratchet: violations and execution errors must refuse
 * the merge, and the temp worktree must be removed on every path (task 1021).
 * Also pins the PR-risk step order (workflows → ratchet → risk) and that a
 * risk hold maps to reason 'risk_hold' only in merge mode (task 1031).
 */
import { describe, it, expect } from 'bun:test';
import {
  evaluatePreMergeGate,
  runRatchetAtRef,
  type PreMergeGateDeps,
  type RatchetDeps,
} from './auto-merge-premerge-gate';

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

describe('evaluatePreMergeGate — PR-risk step', () => {
  function gateDeps(over: Partial<PreMergeGateDeps> = {}) {
    const order: string[] = [];
    const riskCalls: unknown[][] = [];
    const deps: PreMergeGateDeps = {
      checkWorkflows: async () => {
        order.push('workflows');
        return { complete: true, waiting: [] };
      },
      runRatchet: async () => {
        order.push('ratchet');
        return { verdict: 'pass' };
      },
      evaluateRisk: async (...args) => {
        order.push('risk');
        riskCalls.push(args);
        return { hold: false };
      },
      ...over,
    };
    return { deps, order, riskCalls };
  }

  it('runs workflows → ratchet → risk and passes when nothing holds', async () => {
    const g = gateDeps();
    expect(await evaluatePreMergeGate('/repo', 3, { localRatchet: true }, g.deps)).toEqual({
      ok: true,
    });
    expect(g.order).toEqual(['workflows', 'ratchet', 'risk']);
    expect(g.riskCalls[0]).toEqual(['/repo', 3, 'merge', { taskId: null, agentAuthored: true }]);
  });

  it('returns risk_hold with the risk detail when the risk step holds', async () => {
    const g = gateDeps({ evaluateRisk: async () => ({ hold: true, detail: 'risk 90.0%' }) });
    expect(await evaluatePreMergeGate('/repo', 3, { localRatchet: true }, g.deps)).toEqual({
      ok: false,
      reason: 'risk_hold',
      detail: 'risk 90.0%',
    });
  });

  it('does not evaluate risk while workflows are pending or the ratchet fails', async () => {
    const pending = gateDeps({ checkWorkflows: async () => ({ complete: false, waiting: ['x'] }) });
    expect((await evaluatePreMergeGate('/repo', 3, { localRatchet: true }, pending.deps)).ok).toBe(
      false,
    );
    expect(pending.riskCalls).toHaveLength(0);

    const bad = gateDeps({ runRatchet: async () => ({ verdict: 'violation', detail: 'a.ts' }) });
    const r = await evaluatePreMergeGate('/repo', 3, { localRatchet: true }, bad.deps);
    expect(r).toMatchObject({ ok: false, reason: 'ratchet_violation' });
    expect(bad.riskCalls).toHaveLength(0);
  });

  it('pr mode skips the ratchet and asks the risk step in pr mode', async () => {
    const g = gateDeps();
    expect(await evaluatePreMergeGate('/repo', 3, { localRatchet: false }, g.deps)).toEqual({
      ok: true,
    });
    expect(g.order).toEqual(['workflows', 'risk']);
    expect(g.riskCalls[0][2]).toBe('pr');
  });

  it('fails open when the risk step itself throws', async () => {
    const g = gateDeps({
      evaluateRisk: async () => {
        throw new Error('db gone');
      },
    });
    expect(await evaluatePreMergeGate('/repo', 3, { localRatchet: true }, g.deps)).toEqual({
      ok: true,
    });
  });
});
