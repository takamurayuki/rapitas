/**
 * event-loop-lag-watchdog stall-kind tests
 *
 * Verifies that a single >=15s stall is only treated as a restart-worthy hang
 * when the process was actually burning CPU (2026-10-08..12: five daily
 * self-restarts after stalls that had already recovered by the time the timer ran).
 */
import { describe, test, expect, mock, afterEach } from 'bun:test';

type LogCall = [Record<string, unknown>, string];

const warnCalls: LogCall[] = [];
const noopLogger = {
  info: () => {},
  error: () => {},
  warn: (fields: Record<string, unknown>, msg: string) => {
    warnCalls.push([fields, msg]);
  },
  debug: () => {},
  fatal: () => {},
};

mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { startEventLoopLagWatchdog, stopEventLoopLagWatchdog } =
  await import('./event-loop-lag-watchdog');

interface HealCall {
  reason: string;
  diagnosis: { stallKind: string; cpuRatio: number };
}

/**
 * Drives the real interval callback under a controlled clock. `cpuRatio` is the
 * fraction of each tick's wall time the stubbed process.cpuUsage() reports as
 * busy; `'throw'` makes cpuUsage() throw.
 */
function run(lagMsList: number[], cpuRatio: number | 'throw'): HealCall[] {
  const realNow = Date.now;
  const realInterval = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  const realCpuUsage = process.cpuUsage;
  let clockMs = 10_000;
  let cpuMicros = 0;
  let tick: (() => void) | undefined;
  let intervalMs = 0;
  const heals: HealCall[] = [];
  Date.now = () => clockMs;
  process.cpuUsage = (() => {
    if (cpuRatio === 'throw') throw new Error('cpuUsage unavailable');
    return { user: cpuMicros, system: 0 };
  }) as typeof process.cpuUsage;
  globalThis.setInterval = ((callback: () => void, ms: number) => {
    tick = callback;
    intervalMs = ms;
    return 1;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;
  try {
    startEventLoopLagWatchdog((reason, _sections, _recent, diagnosis) => {
      heals.push({ reason, diagnosis });
    });
    for (const lagMs of lagMsList) {
      const elapsed = intervalMs + lagMs;
      clockMs += elapsed;
      if (cpuRatio !== 'throw') cpuMicros += elapsed * cpuRatio * 1000;
      tick!();
    }
  } finally {
    stopEventLoopLagWatchdog();
    Date.now = realNow;
    process.cpuUsage = realCpuUsage;
    globalThis.setInterval = realInterval;
    globalThis.clearInterval = realClear;
  }
  return heals;
}

describe('event-loop-lag-watchdog stall kind', () => {
  afterEach(() => {
    stopEventLoopLagWatchdog();
    warnCalls.length = 0;
  });

  test('単発15s超でもCPUをほぼ使っていない停止は再起動せずWARNに分類を残す', () => {
    const heals = run([17_000], 0.05);
    expect(heals).toHaveLength(0);
    const [fields] = warnCalls[0];
    expect(fields.stallKind).toBe('not-scheduled');
    expect(fields.selfHealSkipped).toBe('not-scheduled-single-stall');
  });

  test('CPUを使っていた単発15s超の停止は従来どおり再起動する', () => {
    const heals = run([17_000], 1);
    expect(heals).toHaveLength(1);
    expect(heals[0].reason).toContain('single stall');
    expect(heals[0].diagnosis.stallKind).toBe('cpu-bound');
    expect('selfHealSkipped' in warnCalls[0][0]).toBe(false);
  });

  test('cpuUsage()が例外を投げたら cpu-bound 扱いで再起動する', () => {
    const heals = run([17_000], 'throw');
    expect(heals).toHaveLength(1);
    expect(heals[0].diagnosis.stallKind).toBe('cpu-bound');
  });

  test('not-scheduled の累積は 29_999ms で不発、30_000ms で発火する', () => {
    expect(run([15_000, 14_999], 0.05)).toHaveLength(0);
    const heals = run([15_000, 15_000], 0.05);
    expect(heals).toHaveLength(1);
    expect(heals[0].reason).toContain('cumulative stall');
  });

  test('抑止は healingTriggered を立てない（同一run内の後続停止でも判定が生きる）', () => {
    // 1st idle 16s is skipped; 2nd idle 16s pushes the window to 32s and must restart.
    const heals = run([16_000, 16_000], 0.05);
    expect(heals).toHaveLength(1);
    expect(heals[0].reason).toContain('cumulative stall');
  });

  test('メッセージ本文は不変で署名は ~#.#s のまま', () => {
    run([17_000], 0.05);
    const msg = warnCalls[0][1];
    expect(msg).toBe('Event loop stalled ~17.0s');
    expect(msg.replace(/\d+/g, '#')).toBe('Event loop stalled ~#.#s');
  });
});
