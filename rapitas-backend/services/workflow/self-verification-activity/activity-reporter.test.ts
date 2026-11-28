/**
 * activity-reporter.test
 *
 * The reporter turns the marker files of one worktree into the two log lines
 * the screen orders by (`[SelfVerification] waiting` / `result`), and lets a
 * watchdog hold its result until the verdict is out. Resolution must come
 * AFTER the result line, and a stop request must end the wait.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import type { ActivityStore, SelfVerificationActivity } from './activity-store';
import {
  createSelfVerificationReporter,
  formatResultLine,
  formatWaitingLine,
} from './activity-reporter';

const WT = 'C:/x/.worktrees/t-7';
let records: SelfVerificationActivity[];

function rec(over: Partial<SelfVerificationActivity>): SelfVerificationActivity {
  return {
    runId: 'r1',
    taskId: 7,
    worktreeKey: 'c:/x/.worktrees/t-7',
    worktreePath: WT,
    ownerPid: 1,
    startedAt: 10_000,
    updatedAt: 10_000,
    state: 'running',
    ...over,
  };
}

const fakeStore: ActivityStore = {
  markStarted: () => {},
  markFinished: () => {},
  listForWorktree: () => records,
  listForTask: () => records,
  isRunning: (r) => r.state === 'running',
  isActiveForWorktree: () => records.some((r) => r.state === 'running'),
};

beforeEach(() => {
  records = [];
});

describe('createSelfVerificationReporter.tick', () => {
  test('emits the waiting line once, then the result line once', () => {
    const lines: string[] = [];
    const r = createSelfVerificationReporter({
      workDir: WT,
      executionStartedAt: 10_000,
      emit: (l) => lines.push(l),
      store: fakeStore,
    });
    records = [rec({})];
    r.tick();
    r.tick();
    expect(lines).toEqual([formatWaitingLine('r1')]);
    records = [rec({ state: 'finished', ok: true, unverifiable: false, passed: 4, failed: 0 })];
    r.tick();
    r.tick();
    expect(lines).toEqual([
      '[SelfVerification] waiting runId=r1\n',
      '[SelfVerification] result runId=r1 ok=true unverifiable=false passed=4 failed=0\n',
    ]);
  });

  test('a run that finished between ticks still gets waiting before result', () => {
    const lines: string[] = [];
    const r = createSelfVerificationReporter({
      workDir: WT,
      executionStartedAt: 10_000,
      emit: (l) => lines.push(l),
      store: fakeStore,
    });
    records = [rec({ state: 'finished', ok: false, unverifiable: false, passed: 2, failed: 1 })];
    r.tick();
    expect(lines).toEqual([
      formatWaitingLine('r1'),
      formatResultLine(rec({ ok: false, unverifiable: false, passed: 2, failed: 1 })),
    ]);
  });

  test('does not report a run that began before this execution, but still counts it as active', () => {
    const lines: string[] = [];
    const r = createSelfVerificationReporter({
      workDir: WT,
      executionStartedAt: 60_000,
      emit: (l) => lines.push(l),
      store: fakeStore,
    });
    records = [rec({ startedAt: 10_000 })];
    r.tick();
    expect(lines).toEqual([]);
    expect(r.isActive()).toBe(true);
  });

  test('without a work directory nothing is active or reported', () => {
    const lines: string[] = [];
    records = [rec({})];
    const r = createSelfVerificationReporter({
      workDir: undefined,
      executionStartedAt: 0,
      emit: (l) => lines.push(l),
      store: fakeStore,
    });
    r.tick();
    expect(r.isActive()).toBe(false);
    expect(lines).toEqual([]);
  });

  test('a store that throws reads as inactive', () => {
    const broken: ActivityStore = {
      ...fakeStore,
      listForWorktree: () => {
        throw new Error('disk');
      },
    };
    const r = createSelfVerificationReporter({
      workDir: WT,
      executionStartedAt: 0,
      emit: () => {},
      store: broken,
    });
    expect(() => r.tick()).not.toThrow();
    expect(r.isActive()).toBe(false);
  });
});

describe('createSelfVerificationReporter.waitUntilSettled', () => {
  test('resolves only after the result line was emitted', async () => {
    const events: string[] = [];
    records = [rec({})];
    let sleeps = 0;
    const r = createSelfVerificationReporter({
      workDir: WT,
      executionStartedAt: 10_000,
      emit: (l) => events.push(l.trim().split(' ')[1]),
      store: fakeStore,
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 3) {
          records = [
            rec({ state: 'finished', ok: true, unverifiable: false, passed: 1, failed: 0 }),
          ];
        }
      },
    });
    const outcome = await r.waitUntilSettled({ isCancelled: () => false });
    events.push('resolved');
    expect(outcome).toBe('settled');
    expect(events).toEqual(['waiting', 'result', 'resolved']);
    expect(sleeps).toBe(3);
  });

  test('returns immediately when nothing is running', async () => {
    let sleeps = 0;
    const r = createSelfVerificationReporter({
      workDir: WT,
      executionStartedAt: 0,
      emit: () => {},
      store: fakeStore,
      sleep: async () => {
        sleeps += 1;
      },
    });
    expect(await r.waitUntilSettled({ isCancelled: () => false })).toBe('settled');
    expect(sleeps).toBe(0);
  });

  test('a stop request ends the wait as cancelled', async () => {
    records = [rec({})];
    let cancelled = false;
    let sleeps = 0;
    const r = createSelfVerificationReporter({
      workDir: WT,
      executionStartedAt: 10_000,
      emit: () => {},
      store: fakeStore,
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 2) cancelled = true;
      },
    });
    expect(await r.waitUntilSettled({ isCancelled: () => cancelled })).toBe('cancelled');
    expect(sleeps).toBe(2);
  });
});
