/**
 * idle-monitor.test
 *
 * Task 1582: while self-verification ran, the waiting Claude Code CLI printed
 * nothing and the 5-minute idle-hang rule force-killed it. The monitor must
 * hold the kill while a self-verification marker is live for the worktree,
 * and kill as before once there is none or it has passed its limit.
 * Time, intervals and the kill are injected; nothing real is spawned.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChildProcess } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startIdleMonitor, type IdleMonitorCallbacks } from './idle-monitor';
import {
  createActivityStore,
  SELF_VERIFICATION_ACTIVE_LIMIT_MS,
  type MonitorClock,
} from '../../workflow/self-verification-activity';

const WT = 'C:/x/.worktrees/task-1582';
const IDLE_KILL_MS = 300_000;
const LONG_TIMEOUT = 4 * 60 * 60 * 1000; // keeps the wall-clock cap out of these tests

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

function harness(opts: { isSelfVerificationActive?: () => boolean; onTick?: () => void }) {
  const fc = fakeClock();
  const kills: string[] = [];
  const flushed: string[] = [];
  const proc = { pid: 4242, killed: false, kill: () => true } as unknown as ChildProcess;
  const callbacks: IdleMonitorCallbacks = {
    onFlushLineBuffer: (c) => flushed.push(c),
    onTimeout: () => kills.push('timeout'),
    getLineBuffer: () => '',
    getOutputBufferLength: () => 10,
    getStatus: () => 'running',
    getProcess: () => proc,
    setIdleTimeoutForceKilled: () => {},
    setWallClockTimeoutForceKilled: () => {},
    getOutputBuffer: () => '',
    getErrorBuffer: () => '',
    ...opts,
  };
  const handles = startIdleMonitor('[test]', LONG_TIMEOUT, fc.now(), callbacks, {
    clock: fc.clock,
    killTree: (_p, reason) => kills.push(reason),
  });
  handles.markReceivedOutput();
  handles.recordOutput();
  return { ...fc, kills, flushed, handles };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'idle-monitor-sv-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('startIdleMonitor — self-verification hold (task 1582)', () => {
  test('control: without the self-verification check, 5 minutes of silence force-kills (pre-fix behaviour)', () => {
    const h = harness({});
    h.advance(IDLE_KILL_MS + 10_000);
    expect(h.kills).toEqual(['idle-hang']);
    expect(h.flushed.join('')).toContain('treating as hang');
    h.handles.cleanup();
  });

  test('while self-verification is running, 5+ minutes of silence does not kill', () => {
    const h = harness({ isSelfVerificationActive: () => true });
    h.advance(IDLE_KILL_MS + 1_000);
    h.advance(20 * 60 * 1000);
    expect(h.kills).toEqual([]);
    expect(h.flushed.join('')).not.toContain('treating as hang');
    h.handles.cleanup();
  });

  test('when self-verification is not running, it kills as before', () => {
    const h = harness({ isSelfVerificationActive: () => false });
    h.advance(IDLE_KILL_MS + 10_000);
    expect(h.kills).toEqual(['idle-hang']);
    h.handles.cleanup();
  });

  test('once self-verification ends, the 5-minute rule restarts from that moment', () => {
    let active = true;
    const h = harness({ isSelfVerificationActive: () => active });
    h.advance(10 * 60 * 1000);
    active = false;
    h.advance(IDLE_KILL_MS - 10_000);
    expect(h.kills).toEqual([]);
    h.advance(20_000);
    expect(h.kills).toEqual(['idle-hang']);
    h.handles.cleanup();
  });

  test('a self-verification past its limit no longer holds the kill', () => {
    const fcStore = { now: 0 };
    const store = createActivityStore({
      dir,
      now: () => fcStore.now,
      isPidAlive: () => true,
    });
    let h: ReturnType<typeof harness> | null = null;
    h = harness({
      isSelfVerificationActive: () => {
        fcStore.now = h ? h.now() : fcStore.now;
        return store.isActiveForWorktree(WT);
      },
    });
    fcStore.now = h.now();
    store.markStarted({ runId: 'r1', taskId: 1582, worktreePath: WT });
    h.advance(SELF_VERIFICATION_ACTIVE_LIMIT_MS - 5_000);
    expect(h.kills).toEqual([]);
    // Limit reached: the marker stops counting, so the idle rule applies again.
    h.advance(5_000 + IDLE_KILL_MS + 10_000);
    expect(h.kills).toEqual(['idle-hang']);
    h.handles.cleanup();
  });

  test('onTick runs on every idle check so the reporter can emit its lines', () => {
    let ticks = 0;
    const h = harness({ onTick: () => (ticks += 1) });
    h.advance(30_000);
    expect(ticks).toBe(6);
    h.handles.cleanup();
  });
});
