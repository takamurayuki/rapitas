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

const {
  formatEventLoopLagMessage,
  startEventLoopLagWatchdog,
  stopEventLoopLagWatchdog,
  markEventLoopSection,
} = await import('./event-loop-lag-watchdog');

function normalize(msg: string): string {
  return msg.replace(/\d+/g, '#');
}

/** Advance the real watchdog callback with an exact, controlled clock. */
function triggerLag(lagMs: number): void {
  triggerLags([lagMs]);
}

/**
 * Runs one watchdog session through a sequence of lags, each applied as one
 * tick of the real interval callback, under a fully controlled clock —
 * needed for the self-heal thresholds, which only fire after multiple ticks
 * (or one very large one). Returns the reasons passed to `selfHeal`, if any.
 */
function triggerLags(
  lagMsList: number[],
  selfHeal: (
    reason: string,
    sections: Array<{ name: string; runningMs: number }>,
    recentSections: Array<{ name: string; durationMs: number; endedAgoMs: number }>,
  ) => void = () => {},
  beforeTick: (tickIndex: number, advance: (ms: number) => void) => void = () => {},
): string[] {
  const realNow = Date.now;
  const realInterval = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  const realCpuUsage = process.cpuUsage;
  let clockMs = 10_000;
  let tick: (() => void) | undefined;
  let intervalMs = 0;
  const reasons: string[] = [];
  Date.now = () => clockMs;
  // CPU fully busy: every stall is cpu-bound, so existing thresholds apply unchanged.
  process.cpuUsage = (() => ({ user: clockMs * 1000, system: 0 })) as typeof process.cpuUsage;
  globalThis.setInterval = ((callback: () => void, ms: number) => {
    tick = callback;
    intervalMs = ms;
    return 1;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;
  try {
    startEventLoopLagWatchdog((reason, sections, recentSections) => {
      reasons.push(reason);
      selfHeal(reason, sections, recentSections);
    });
    expect(intervalMs).toBe(500);
    expect(tick).toBeDefined();
    for (const [index, lagMs] of lagMsList.entries()) {
      beforeTick(index, (ms) => {
        clockMs += ms;
      });
      clockMs += intervalMs + lagMs;
      tick!();
    }
  } finally {
    stopEventLoopLagWatchdog();
    Date.now = realNow;
    process.cpuUsage = realCpuUsage;
    globalThis.setInterval = realInterval;
    globalThis.clearInterval = realClear;
  }
  return reasons;
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

  test('does not warn at the threshold and warns immediately above it', () => {
    triggerLag(2000);
    expect(warnCalls).toHaveLength(0);
    triggerLag(2001);
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0][0].lagMs).toBe(2001);
  });

  test('閾値超過時にWARNが発火し、lagMsは構造化フィールドとして保持される', async () => {
    triggerLag(5000);

    expect(warnCalls.length).toBeGreaterThan(0);
    const [fields, msg] = warnCalls[0];
    expect(msg).toBe(formatEventLoopLagMessage(fields.lagMs as number));
    expect(typeof fields.lagMs).toBe('number');
    expect(fields.lagMs as number).toBeGreaterThan(2000);
  });

  test('lagMsの値(整数秒/小数秒)によらずメッセージのシグネチャは同一になる', async () => {
    triggerLag(2001);
    stopEventLoopLagWatchdog();
    const firstMsg = warnCalls[0]?.[1];
    warnCalls.length = 0;

    triggerLag(2700);
    const secondMsg = warnCalls[0]?.[1];

    expect(firstMsg).toBeDefined();
    expect(secondMsg).toBeDefined();
    expect(normalize(firstMsg as string)).toBe(normalize(secondMsg as string));
    expect(normalize(firstMsg as string)).toBe('Event loop stalled ~#.#s');
  });
});

describe('event-loop-lag-watchdog self-heal (2026-09-18 incident)', () => {
  afterEach(() => {
    stopEventLoopLagWatchdog();
    warnCalls.length = 0;
  });

  test('a single catastrophic stall (>=15s) triggers self-heal immediately', () => {
    const reasons = triggerLags([15_000]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('single stall');
  });

  test('a moderate stall well under both thresholds never triggers self-heal', () => {
    const reasons = triggerLags([3000, 3000, 3000]);
    expect(reasons).toHaveLength(0);
  });

  test('repeated moderate stalls that sum to >=30s within the window trigger self-heal', () => {
    // 10 x 3000ms = 30000ms, each tick ~3.5s apart -> well inside the 120s window.
    const reasons = triggerLags(Array(10).fill(3000));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('cumulative stall');
  });

  test('self-heal fires at most once per watchdog run even if lag keeps recurring', () => {
    const reasons = triggerLags([15_000, 15_000, 15_000]);
    expect(reasons).toHaveLength(1);
  });

  test("a fresh watchdog run does not inherit the previous run's stall history", () => {
    triggerLags([20_000]);
    // A brand-new run (stopEventLoopLagWatchdog() ran in triggerLags' finally
    // block) must start clean, not immediately re-trigger from stale state.
    const reasons = triggerLags([3000]);
    expect(reasons).toHaveLength(0);
  });
});

describe('markEventLoopSection — 停止元の名指し', () => {
  afterEach(() => {
    stopEventLoopLagWatchdog();
    warnCalls.length = 0;
  });

  test('登録中のセクションがあればactiveSectionsを付与し、本文は不変', () => {
    const done = markEventLoopSection('log-health-check');
    triggerLag(4900);
    done();
    const [fields, msg] = warnCalls[0];
    expect(msg).toBe('Event loop stalled ~4.9s');
    expect(normalize(msg)).toBe('Event loop stalled ~#.#s');
    const sections = fields.activeSections as Array<{ name: string; runningMs: number }>;
    expect(sections.map((s) => s.name)).toEqual(['log-health-check']);
    expect(typeof sections[0].runningMs).toBe('number');
  });

  test('未登録ならactiveSectionsを付けない', () => {
    triggerLag(4900);
    expect('activeSections' in warnCalls[0][0]).toBe(false);
  });

  test('解除後は付与されず、二重解除は冪等', () => {
    const done = markEventLoopSection('backlog-job:health_check');
    done();
    done();
    triggerLag(4900);
    expect('activeSections' in warnCalls[0][0]).toBe(false);
  });

  test('self-heal発火時に実行中セクションを自己修復アクションへ渡す（原因の名指し）', () => {
    const done = markEventLoopSection('backlog-job:daily');
    let received: Array<{ name: string; runningMs: number }> = [];
    triggerLags([15_000], (_reason, sections) => {
      received = sections;
    });
    done();
    expect(received.map((s) => s.name)).toEqual(['backlog-job:daily']);
  });

  test('セクション未登録のself-healは空配列を渡す', () => {
    let received: unknown[] | undefined;
    triggerLags([15_000], (_reason, sections) => {
      received = sections;
    });
    expect(received).toEqual([]);
  });

  test('同名の並行実行は片方の解除で他方を消さない', () => {
    const a = markEventLoopSection('job');
    const b = markEventLoopSection('job');
    a();
    triggerLag(4900);
    const sections = warnCalls[0][0].activeSections as Array<{ name: string }>;
    expect(sections).toHaveLength(1);
    b();
  });
});

describe('markEventLoopSection — 解放済み区間の履歴 (#1208)', () => {
  afterEach(() => {
    stopEventLoopLagWatchdog();
    warnCalls.length = 0;
  });

  type Recent = Array<{ name: string; durationMs: number; endedAgoMs: number }>;

  test('停止中に解放された区間は recentSections として WARN に付与される', () => {
    triggerLags([5000], undefined, (_i, advance) => {
      const done = markEventLoopSection('worktree-cleanup');
      advance(1000);
      done();
    });
    const fields = warnCalls[0][0];
    const recent = fields.recentSections as Recent;
    expect(recent.map((s) => s.name)).toEqual(['worktree-cleanup']);
    expect(recent[0].durationMs).toBe(1000);
    expect('activeSections' in fields).toBe(false);
  });

  test('停止開始より前に解放された区間は付与しない', () => {
    triggerLags([0, 3000], undefined, (i, advance) => {
      if (i === 0) {
        const done = markEventLoopSection('early-section');
        done();
      } else {
        advance(60_000);
      }
    });
    expect('recentSections' in warnCalls[0][0]).toBe(false);
  });

  test('履歴は新しい順に上限8件で打ち切る', () => {
    triggerLags([5000], undefined, (_i, advance) => {
      for (let n = 0; n < 12; n++) {
        const done = markEventLoopSection(`s${n}`);
        advance(100);
        done();
      }
    });
    const recent = warnCalls[0][0].recentSections as Recent;
    expect(recent).toHaveLength(8);
    expect(recent[0].name).toBe('s11');
  });

  test('self-heal に recentSections と process メトリクスが渡る', () => {
    let received: Recent = [];
    triggerLags(
      [20_000],
      (_reason, _sections, recent) => {
        received = recent;
      },
      (_i, advance) => {
        const done = markEventLoopSection('backlog-job:daily');
        advance(1000);
        done();
      },
    );
    expect(received.map((s) => s.name)).toEqual(['backlog-job:daily']);
    expect(typeof warnCalls[0][0].heapUsedMb).toBe('number');
    expect(typeof warnCalls[0][0].rssMb).toBe('number');
  });

  test('stop で履歴をクリアし次回 run に持ち越さない', () => {
    triggerLags([0], undefined, () => {
      markEventLoopSection('leftover')();
    });
    triggerLags([5000]);
    expect('recentSections' in warnCalls[0][0]).toBe(false);
  });
});
