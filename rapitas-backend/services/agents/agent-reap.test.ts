/**
 * agent-reap.test
 *
 * 2026-11-22 (trendline task 1520): verifiers started the app with start.bat /
 * Start-Process, which detaches it from the agent's tree. The post-exit reap
 * only knew the agent's descendants, so server.exe / worker.exe stayed up
 * holding port 8090 and every next verification failed with "port in use".
 * The reap now also sweeps processes whose command line names the task
 * worktree, through killProcessTreeSafely's existing guarded workdir match.
 */
import { describe, expect, test } from 'bun:test';
import { scheduleAgentReap, type ReapDeps } from './agent-reap';

function deps() {
  const kills: Array<{ pid: number; opts: { workdir?: string; knownTargets?: Iterable<number> } }> =
    [];
  let fire: (() => void) | null = null;
  const d: ReapDeps = {
    capture: () => new Set([11, 12]),
    kill: (pid, opts) => {
      kills.push({ pid, opts });
      return true;
    },
    schedule: (fn) => {
      fire = fn;
    },
  };
  return { d, kills, run: () => fire?.() };
}

describe('scheduleAgentReap', () => {
  test('sweeps the task worktree when the agent ran inside one', () => {
    const { d, kills, run } = deps();
    scheduleAgentReap(4321, 'C:\\Projects\\trendline\\.worktrees\\task-1520-55fd12ec', d);
    run();
    expect(kills).toHaveLength(1);
    expect(kills[0].pid).toBe(4321);
    expect(kills[0].opts.workdir).toBe('C:\\Projects\\trendline\\.worktrees\\task-1520-55fd12ec');
    expect([...(kills[0].opts.knownTargets ?? [])]).toEqual([11, 12]);
  });

  test('never sweeps by path outside a task worktree (e.g. a primary checkout)', () => {
    const { d, kills, run } = deps();
    scheduleAgentReap(4321, 'C:\\Projects\\trendline', d);
    run();
    expect(kills[0].opts.workdir).toBeUndefined();
  });

  test('captures descendants before the delay, while parent links are live', () => {
    const order: string[] = [];
    const { d } = deps();
    d.capture = () => {
      order.push('capture');
      return new Set();
    };
    d.schedule = () => {
      order.push('schedule');
    };
    scheduleAgentReap(1, 'C:\\x\\.worktrees\\task-1-a', d);
    expect(order).toEqual(['capture', 'schedule']);
  });
});

// Task 1582: the gate's lint/test processes run with the worktree in their
// command line. Sweeping by path while self-verification runs would kill them
// and record a failed check, so the sweep is skipped (own tree only) then.
describe('scheduleAgentReap — self-verification in the worktree (task 1582)', () => {
  const WT = 'C:\\Projects\\rapitas\\.worktrees\\task-1582-3d992549';

  test('while self-verification runs, only the agent tree is reaped (no worktree sweep)', () => {
    const { d, kills, run } = deps();
    const asked: string[] = [];
    d.isSelfVerificationActive = (wd) => {
      asked.push(wd);
      return true;
    };
    scheduleAgentReap(4321, WT, d);
    run();
    expect(asked).toEqual([WT]);
    expect(kills).toHaveLength(1);
    expect(kills[0].opts.workdir).toBeUndefined();
    expect([...(kills[0].opts.knownTargets ?? [])]).toEqual([11, 12]);
  });

  test('with no self-verification running, the worktree is swept as before', () => {
    const { d, kills, run } = deps();
    d.isSelfVerificationActive = () => false;
    scheduleAgentReap(4321, WT, d);
    run();
    expect(kills[0].opts.workdir).toBe(WT);
  });

  test('the check happens when the reap fires, not when it is scheduled', () => {
    const { d, kills, run } = deps();
    let active = false;
    d.isSelfVerificationActive = () => active;
    scheduleAgentReap(4321, WT, d);
    active = true;
    run();
    expect(kills[0].opts.workdir).toBeUndefined();
  });
});
