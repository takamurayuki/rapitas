/**
 * event-loop-lag-watchdog ユニットテスト
 *
 * 閾値超過時にWARNが発火すること、およびメッセージ文言がlagMsの値に依存しない
 * 固定文言であること（#863: 秒数埋め込みによる懸念シグネチャ分裂の再発防止）を検証する。
 */
import { describe, test, expect, mock, afterEach } from 'bun:test';

type WarnCall = [Record<string, unknown>, string];

const warnCalls: WarnCall[] = [];
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

/** Force the next N Date.now() reads to jump forward, simulating an event-loop stall without a real-time wait. */
function withForcedLag<T>(jumpMs: number, fn: () => Promise<T>): Promise<T> {
  const realNow = Date.now;
  let calls = 0;
  Date.now = (() => {
    calls += 1;
    // 1st call: startEventLoopLagWatchdog's initial `expected` baseline (no jump).
    // subsequent calls: interval tick reads `now` — jump forward to force lag.
    return calls === 1 ? realNow() : realNow() + jumpMs;
  }) as typeof Date.now;
  return fn().finally(() => {
    Date.now = realNow;
  });
}

describe('event-loop-lag-watchdog', () => {
  afterEach(() => {
    stopEventLoopLagWatchdog();
    warnCalls.length = 0;
  });

  test('閾値超過時にWARNが発火し、lagMsは構造化フィールドとして保持される', async () => {
    await withForcedLag(5000, async () => {
      startEventLoopLagWatchdog();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(warnCalls.length).toBeGreaterThan(0);
    const [fields, msg] = warnCalls[0];
    expect(msg).toBe('Event loop stalled');
    expect(typeof fields.lagMs).toBe('number');
    expect(fields.lagMs as number).toBeGreaterThan(2000);
  });

  test('lagMsの値(整数秒/小数秒)によらずメッセージ文言は同一のシグネチャになる', async () => {
    await withForcedLag(2001, async () => {
      startEventLoopLagWatchdog();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    stopEventLoopLagWatchdog();
    const firstMsg = warnCalls[0]?.[1];
    warnCalls.length = 0;

    await withForcedLag(2700, async () => {
      startEventLoopLagWatchdog();
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    const secondMsg = warnCalls[0]?.[1];

    expect(firstMsg).toBeDefined();
    expect(secondMsg).toBeDefined();
    expect(firstMsg).toBe(secondMsg);
    expect(firstMsg).not.toMatch(/\d/);
  });
});
