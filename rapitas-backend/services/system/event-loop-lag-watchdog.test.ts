/**
 * event-loop-lag-watchdog ユニットテスト
 *
 * 閾値超過時にWARNが発火すること、およびメッセージが常に固定の小数点以下1桁の
 * digit shape ("~#.#s") に正規化されること（#864: 秒数埋め込みによる懸念シグネチャ
 * 分裂の再発防止）を検証する。
 */
import { describe, it, test, expect, mock, afterEach } from 'bun:test';

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

const { formatEventLoopLagMessage, startEventLoopLagWatchdog, stopEventLoopLagWatchdog } =
  await import('./event-loop-lag-watchdog');

function normalize(msg: string): string {
  return msg.replace(/\d+/g, '#');
}

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

describe('formatEventLoopLagMessage', () => {
  it('formats a fractional-second lag with one decimal place', () => {
    expect(formatEventLoopLagMessage(2161)).toBe('Event loop stalled ~2.2s');
  });

  it('formats an integer-second lag with a trailing .0 (not bare seconds)', () => {
    expect(formatEventLoopLagMessage(2001)).toBe('Event loop stalled ~2.0s');
  });

  it('normalizes integer-second and fractional-second lags to the same signature', () => {
    const integerLagMsg = formatEventLoopLagMessage(2001);
    const fractionalLagMsg = formatEventLoopLagMessage(2161);
    expect(normalize(integerLagMsg)).toBe(normalize(fractionalLagMsg));
    expect(normalize(integerLagMsg)).toBe('Event loop stalled ~#.#s');
  });

  it('normalizes a large lag (11354ms) to the same signature shape', () => {
    expect(normalize(formatEventLoopLagMessage(11354))).toBe('Event loop stalled ~#.#s');
  });
});

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
    expect(msg).toBe(formatEventLoopLagMessage(fields.lagMs as number));
    expect(typeof fields.lagMs).toBe('number');
    expect(fields.lagMs as number).toBeGreaterThan(2000);
  });

  test('lagMsの値(整数秒/小数秒)によらずメッセージのシグネチャは同一になる', async () => {
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
    expect(normalize(firstMsg as string)).toBe(normalize(secondMsg as string));
    expect(normalize(firstMsg as string)).toBe('Event loop stalled ~#.#s');
  });
});
