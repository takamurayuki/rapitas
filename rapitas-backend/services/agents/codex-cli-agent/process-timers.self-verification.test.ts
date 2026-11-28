/**
 * process-timers.self-verification.test
 *
 * Task 1582 for the Codex CLI: its only silence rule is the no-output
 * timeout (config.timeout, 900 s by default). While self-verification runs
 * in the worktree that timeout must be held; with none running, or once the
 * run is past its limit, it fires as before. The close handler must not
 * resolve until the verdict is out, and a stop request ends that wait.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChildProcess } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AgentExecutionResult } from '../base-agent';
import { createInitialWaitingState } from '../question-detection';
import { createProcessTimers } from './process-timers';
import { createCodexCloseHandler } from './process-close-handler';
import type { ProcessRunnerCallbacks, ProcessRunnerState } from './process-runner';
import {
  createActivityStore,
  createSelfVerificationReporter,
  SELF_VERIFICATION_ACTIVE_LIMIT_MS,
  type ActivityStore,
  type MonitorClock,
  type SelfVerificationActivity,
} from '../../workflow/self-verification-activity';

const WT = 'C:/x/.worktrees/task-1582';
const TIMEOUT = 900_000;

function fakeClock(start = 1_000_000) {
  let t = start;
  const timers = new Map<number, { fn: () => void; ms: number; next: number }>();
  let seq = 0;
  const clock: MonitorClock = {
    now: () => t,
    setInterval: (fn, ms) => {
      seq += 1;
      timers.set(seq, { fn, ms, next: t + ms });
      return seq;
    },
    clearInterval: (h) => {
      timers.delete(h as number);
    },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    while (t < end) {
      t = Math.min(end, t + 1000);
      for (const timer of [...timers.values()]) {
        if (timer.next <= t) {
          timer.next += timer.ms;
          timer.fn();
        }
      }
    }
  };
  return { clock, advance, now: () => t };
}

function makeState(): ProcessRunnerState & { kills: string[] } {
  const kills: string[] = [];
  const proc = {
    pid: undefined,
    killed: false,
    kill: (sig: string) => {
      kills.push(sig);
      return true;
    },
  } as unknown as ChildProcess;
  return {
    kills,
    process: proc,
    outputBuffer: '',
    errorBuffer: '',
    lineBuffer: '',
    detectedQuestion: createInitialWaitingState(),
    activeTools: new Map(),
    codexSessionId: null,
    actualModel: null,
    status: 'running',
    turnFailed: false,
    turnFailureMessage: null,
    activeCodexCommands: new Map(),
    seenAgentMessageIds: new Set(),
  };
}

const lines: string[] = [];
const callbacks: ProcessRunnerCallbacks = {
  emitOutput: (t) => lines.push(t),
  emitQuestionDetected: () => {},
  onSessionId: () => {},
  onQuestionDetected: () => {},
  onStatusChange: () => {},
  logPrefix: '[codex-test]',
};

function startTimers(active?: () => boolean) {
  const fc = fakeClock();
  const state = makeState();
  const resolved: AgentExecutionResult[] = [];
  const timers = createProcessTimers(state, callbacks, fc.now(), TIMEOUT, (r) => resolved.push(r), {
    clock: fc.clock,
    ...(active ? { selfVerification: { isActive: active, tick: () => {} } } : {}),
  });
  return { fc, state, resolved, timers };
}

let dir: string;
beforeEach(() => {
  lines.length = 0;
  dir = mkdtempSync(join(tmpdir(), 'codex-sv-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createProcessTimers — self-verification hold (task 1582)', () => {
  test('control: without the self-verification check the no-output timeout kills (pre-fix behaviour)', () => {
    const h = startTimers();
    h.fc.advance(TIMEOUT + 10_000);
    expect(h.state.kills).toEqual(['SIGTERM']);
    expect(h.resolved[0].errorMessage).toContain('timed out');
    h.timers.cleanupIdle();
    h.timers.cleanupTimeout();
  });

  test('while self-verification is running, silence past the timeout does not kill', () => {
    const h = startTimers(() => true);
    h.fc.advance(TIMEOUT + 60_000);
    expect(h.state.kills).toEqual([]);
    expect(h.resolved).toEqual([]);
    h.timers.cleanupIdle();
    h.timers.cleanupTimeout();
  });

  test('when self-verification is not running, it kills as before', () => {
    const h = startTimers(() => false);
    h.fc.advance(TIMEOUT + 10_000);
    expect(h.state.kills).toEqual(['SIGTERM']);
  });

  test('a self-verification past its limit no longer holds the timeout', () => {
    let now = 0;
    const store = createActivityStore({ dir, now: () => now, isPidAlive: () => true });
    const fc = fakeClock();
    now = fc.now();
    store.markStarted({ runId: 'r1', taskId: 1582, worktreePath: WT });
    const state = makeState();
    const timers = createProcessTimers(state, callbacks, fc.now(), TIMEOUT, () => {}, {
      clock: fc.clock,
      selfVerification: {
        isActive: () => {
          now = fc.now();
          return store.isActiveForWorktree(WT);
        },
        tick: () => {},
      },
    });
    fc.advance(SELF_VERIFICATION_ACTIVE_LIMIT_MS - 10_000);
    expect(state.kills).toEqual([]);
    fc.advance(10_000 + TIMEOUT + 10_000);
    expect(state.kills).toEqual(['SIGTERM']);
    timers.cleanupIdle();
    timers.cleanupTimeout();
  });
});

describe('createCodexCloseHandler — waits for the verdict (task 1582)', () => {
  let records: SelfVerificationActivity[] = [];
  const fakeStore: ActivityStore = {
    markStarted: () => {},
    markFinished: () => {},
    listForWorktree: () => records,
    listForTask: () => records,
    isRunning: (r) => r.state === 'running',
    isActiveForWorktree: () => records.some((r) => r.state === 'running'),
  };
  const running: SelfVerificationActivity = {
    runId: 'r1',
    taskId: 1582,
    worktreeKey: WT.toLowerCase(),
    worktreePath: WT,
    ownerPid: 1,
    startedAt: 0,
    updatedAt: 0,
    state: 'running',
  };

  function handler(state: ProcessRunnerState, onSleep: (n: number) => void) {
    const events: string[] = [];
    let n = 0;
    const reporter = createSelfVerificationReporter({
      workDir: WT,
      executionStartedAt: 0,
      emit: (l) => events.push(l.trim().split(' ')[1]),
      store: fakeStore,
      sleep: async () => {
        n += 1;
        onSleep(n);
      },
    });
    const results: AgentExecutionResult[] = [];
    const close = createCodexCloseHandler({
      config: {},
      workDir: WT,
      state,
      callbacks,
      startTime: 0,
      timers: { cleanupIdle: () => {}, cleanupTimeout: () => {} },
      handleStdoutLine: () => {},
      argsForLog: [],
      parseArtifacts: () => [],
      parseCommits: () => [],
      resolve: (r) => {
        events.push('resolve');
        results.push(r);
      },
      selfVerification: reporter,
    });
    return { close, events, results };
  }

  test('resolves after the result line', async () => {
    records = [running];
    const state = makeState();
    state.process = null;
    const h = handler(state, (n) => {
      if (n === 2) records = [{ ...running, state: 'finished', ok: true, passed: 2, failed: 0 }];
    });
    await h.close(0);
    expect(h.events).toEqual(['waiting', 'result', 'resolve']);
  });

  test('a stop request during the wait resolves as cancelled', async () => {
    records = [running];
    const state = makeState();
    state.process = null;
    const h = handler(state, () => {
      state.cancelRequested = true;
    });
    await h.close(0);
    expect(h.results).toHaveLength(1);
    expect(h.results[0].failureType).toBe('cancelled');
  });
});
