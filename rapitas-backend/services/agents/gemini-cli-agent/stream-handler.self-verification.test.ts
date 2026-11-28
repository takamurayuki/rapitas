/**
 * stream-handler.self-verification.test
 *
 * Task 1582 for the Gemini CLI: the no-output timeout (config.timeout) is held
 * while self-verification runs in the worktree, fires as before when none
 * runs or the run is past its limit, and onClose is called only after the
 * verdict — or as soon as a stop is requested. Uses a fake ChildProcess and
 * an injected clock; nothing is spawned.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { orderSelfVerificationResults } from '../../../../rapitas-frontend/src/feature/developer-mode/utils/log-self-verification-order';
import { createInitialWaitingState } from '../question-detection';
import {
  attachStreamHandlers,
  type GeminiSelfVerificationOptions,
  type StreamHandlerCallbacks,
} from './stream-handler';
import {
  createActivityStore,
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

function fakeProc() {
  const kills: string[] = [];
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid: undefined,
    killed: false,
    kill: (sig: string) => {
      kills.push(sig);
      return true;
    },
  });
  return { proc: proc as unknown as ChildProcess & EventEmitter, kills };
}

const output: string[] = [];
const callbacks: StreamHandlerCallbacks = {
  onOutput: (t) => output.push(t),
  onOutputBufferAppend: () => {},
  onErrorBufferAppend: () => {},
  onSessionIdUpdate: () => {},
  onCheckpointIdUpdate: () => {},
  onQuestionDetected: () => {},
  onQuestionEmit: () => {},
  onKillProcess: () => {},
};

function attach(sv?: Partial<GeminiSelfVerificationOptions>) {
  const fc = fakeClock();
  const { proc, kills } = fakeProc();
  const events: string[] = [];
  const handles = attachStreamHandlers(
    proc,
    { timeout: TIMEOUT },
    fc.now(),
    '[gemini-test]',
    new Map(),
    { sessionId: null, checkpointId: null },
    { value: createInitialWaitingState() },
    callbacks,
    () => events.push('onClose'),
    () => events.push('failed'),
    sv ? { workDir: WT, isCancelled: () => false, clock: fc.clock, ...sv } : undefined,
  );
  return { fc, proc, kills, events, handles };
}

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
  startedAt: 1_000_000,
  updatedAt: 1_000_000,
  state: 'running',
};

let dir: string;
beforeEach(() => {
  output.length = 0;
  records = [];
  dir = mkdtempSync(join(tmpdir(), 'gemini-sv-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('attachStreamHandlers — self-verification hold (task 1582)', () => {
  test('when self-verification is not running, the no-output timeout kills as before the fix', () => {
    const c = attach({ store: fakeStore });
    c.fc.advance(TIMEOUT + 10_000);
    expect(c.kills).toEqual(['SIGTERM']);
    expect(c.events).toEqual(['failed']);
  });

  test('while self-verification is running, silence past the timeout does not kill', () => {
    records = [running];
    const h = attach({ store: fakeStore });
    h.fc.advance(TIMEOUT + 60_000);
    expect(h.kills).toEqual([]);
    expect(h.events).toEqual([]);
    expect(output.join('')).toContain('[SelfVerification] waiting runId=r1');
    h.handles.cleanupIdleCheck();
    h.handles.cleanupTimeoutCheck();
  });

  test('a self-verification past its limit no longer holds the timeout', () => {
    let now = 0;
    const store = createActivityStore({ dir, now: () => now, isPidAlive: () => true });
    const fc = fakeClock();
    now = fc.now();
    store.markStarted({ runId: 'r1', taskId: 1582, worktreePath: WT });
    const { proc, kills } = fakeProc();
    const handles = attachStreamHandlers(
      proc,
      { timeout: TIMEOUT },
      fc.now(),
      '[gemini-test]',
      new Map(),
      { sessionId: null, checkpointId: null },
      { value: createInitialWaitingState() },
      callbacks,
      () => {},
      () => {},
      {
        workDir: WT,
        isCancelled: () => false,
        clock: fc.clock,
        store: {
          ...store,
          listForWorktree: (p) => {
            now = fc.now();
            return store.listForWorktree(p);
          },
        },
      },
    );
    fc.advance(SELF_VERIFICATION_ACTIVE_LIMIT_MS - 10_000);
    expect(kills).toEqual([]);
    fc.advance(10_000 + TIMEOUT + 10_000);
    expect(kills).toEqual(['SIGTERM']);
    handles.cleanupIdleCheck();
    handles.cleanupTimeoutCheck();
  });
});

describe('attachStreamHandlers — close waits for the verdict (task 1582)', () => {
  test.each([true, false])('次の監視周期前の完了出力を検証結果まで保留する（合否=%p）', (ok) => {
    const h = attach({ store: fakeStore });
    h.fc.advance(5000);
    records = [{ ...running, startedAt: h.fc.now() }];
    const event = JSON.stringify({ type: 'result', subtype: 'success', result: '待機中' });
    try {
      h.proc.stdout!.emit('data', Buffer.from(event + '\n'));
      const visible = () => orderSelfVerificationResults(output.join('').split('\n'));
      expect(visible().some((line) => line.startsWith('[Result:'))).toBe(false);
      expect(visible()).toContain('[SelfVerification] waiting runId=r1');
      records = [{ ...records[0], state: 'finished', ok, passed: 3, failed: ok ? 0 : 1 }];
      h.fc.advance(5000);
      const lines = visible();
      const verdict = lines.findIndex((line) => line.startsWith('[SelfVerification] result'));
      expect(lines[verdict]).toContain(`ok=${ok} unverifiable=false passed=3 failed=${ok ? 0 : 1}`);
      expect(lines.findIndex((line) => line.startsWith('[Result:'))).toBeGreaterThan(verdict);
      expect(output.filter((line) => line.startsWith('[SelfVerification] waiting'))).toHaveLength(
        1,
      );
    } finally {
      h.handles.cleanupIdleCheck();
      h.handles.cleanupTimeoutCheck();
    }
  });

  test('onClose runs only after the result line', async () => {
    records = [running];
    let sleeps = 0;
    const h = attach({
      store: fakeStore,
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 2)
          records = [{ ...running, state: 'finished', ok: true, passed: 5, failed: 0 }];
      },
    });
    h.proc.emit('close', 0);
    await new Promise((r) => setTimeout(r, 20));
    const resultAt = output.findIndex((l) => l.startsWith('[SelfVerification] result'));
    expect(resultAt).toBeGreaterThanOrEqual(0);
    expect(h.events).toEqual(['onClose']);
    expect(sleeps).toBe(2);
  });

  test('without a running self-verification onClose runs straight away', async () => {
    const h = attach({ store: fakeStore, sleep: async () => {} });
    h.proc.emit('close', 0);
    await new Promise((r) => setTimeout(r, 5));
    expect(h.events).toEqual(['onClose']);
  });

  test('a stop request during the wait calls onClose without the verdict', async () => {
    records = [running];
    let cancelled = false;
    const h = attach({
      store: fakeStore,
      isCancelled: () => cancelled,
      sleep: async () => {
        cancelled = true;
      },
    });
    h.proc.emit('close', 0);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.events).toEqual(['onClose']);
    expect(output.join('')).not.toContain('[SelfVerification] result');
  });
});
