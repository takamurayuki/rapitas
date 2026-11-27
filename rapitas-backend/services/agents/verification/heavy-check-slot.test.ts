/**
 * heavy-check-slot.test
 *
 * Proves the cross-task slot lets only N heavy verification commands run at
 * once, hands the slot out in FIFO order, survives double releases and
 * thrown checks, and fails open once a waiter has waited too long.
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces the logger.
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';

const warnings: string[] = [];
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: (_obj: unknown, msg: string) => warnings.push(msg),
    error: () => {},
    debug: () => {},
  }),
}));

const {
  acquireHeavyCheckSlot,
  withHeavyCheckSlot,
  heavyCheckSlotStats,
  resolveHeavyConcurrency,
  resetHeavyCheckSlotForTests,
  setHeavySlotEventSinkForTests,
} = await import('./heavy-check-slot');

/** Manual scheduler so the wait limit fires exactly when a test says so. */
function manualScheduler() {
  const timers: Array<{ fn: () => void; cancelled: boolean }> = [];
  return {
    schedule: (fn: () => void) => {
      const t = { fn, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    fireAll: () => {
      for (const t of timers) if (!t.cancelled) t.fn();
    },
    pending: () => timers.filter((t) => !t.cancelled).length,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  delete process.env.RAPITAS_VERIFY_HEAVY_CONCURRENCY;
  delete process.env.RAPITAS_VERIFY_HEAVY_WAIT_MS;
  warnings.length = 0;
  resetHeavyCheckSlotForTests();
});

afterAll(() => {
  delete process.env.RAPITAS_VERIFY_HEAVY_CONCURRENCY;
  delete process.env.RAPITAS_VERIFY_HEAVY_WAIT_MS;
  resetHeavyCheckSlotForTests();
  mock.restore();
});

describe('resolveHeavyConcurrency', () => {
  test('defaults to 1 and accepts 1..8', () => {
    expect(resolveHeavyConcurrency()).toBe(1);
    process.env.RAPITAS_VERIFY_HEAVY_CONCURRENCY = '3';
    expect(resolveHeavyConcurrency()).toBe(3);
    process.env.RAPITAS_VERIFY_HEAVY_CONCURRENCY = '8';
    expect(resolveHeavyConcurrency()).toBe(8);
  });

  test('invalid values fall back to 1 (never unlimited)', () => {
    for (const bad of ['abc', '0', '-2', '9', '2.5', '', '1e1']) {
      process.env.RAPITAS_VERIFY_HEAVY_CONCURRENCY = bad;
      expect(resolveHeavyConcurrency()).toBe(1);
    }
  });
});

test('待ち時間の設定は30分以上、試験用の指定は短い値を許可する', async () => {
  const holder = await acquireHeavyCheckSlot('holder');
  const waits: number[] = [];
  const schedule = (_fn: () => void, ms: number) => {
    waits.push(ms);
    return () => {};
  };
  const queued = ['1', '1800000', '1800001', '2147483648'].map((value) => {
    process.env.RAPITAS_VERIFY_HEAVY_WAIT_MS = value;
    return acquireHeavyCheckSlot(value, { schedule });
  });
  queued.push(acquireHeavyCheckSlot('test', { schedule, waitMs: 5 }));
  holder();
  for (const grant of queued) (await grant)();
  expect(waits).toEqual([1_800_000, 1_800_000, 1_800_001, 2_147_483_648, 5]);
});

describe('acquireHeavyCheckSlot', () => {
  test('with limit 1, the second acquire waits until the first releases', async () => {
    const sched = manualScheduler();
    const order: string[] = [];
    const a = acquireHeavyCheckSlot('a', { schedule: sched.schedule });
    const b = acquireHeavyCheckSlot('b', { schedule: sched.schedule });
    a.then(() => order.push('a'));
    b.then(() => order.push('b'));
    await flush();
    expect(order).toEqual(['a']);
    expect(heavyCheckSlotStats()).toEqual({ active: 1, waiting: 1 });
    (await a)();
    await flush();
    expect(order).toEqual(['a', 'b']);
    expect(heavyCheckSlotStats()).toEqual({ active: 1, waiting: 0 });
    (await b)();
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });

  test('hands the slot out in FIFO order', async () => {
    const sched = manualScheduler();
    const order: string[] = [];
    const first = await acquireHeavyCheckSlot('first', { schedule: sched.schedule });
    const waiters = ['x', 'y', 'z'].map((l) =>
      acquireHeavyCheckSlot(l, { schedule: sched.schedule }).then((rel) => {
        order.push(l);
        return rel;
      }),
    );
    first();
    for (const w of waiters) (await w)();
    expect(order).toEqual(['x', 'y', 'z']);
  });

  test('RAPITAS_VERIFY_HEAVY_CONCURRENCY=2 lets two run at once', async () => {
    process.env.RAPITAS_VERIFY_HEAVY_CONCURRENCY = '2';
    const sched = manualScheduler();
    let granted = 0;
    const all = [1, 2, 3].map(() =>
      acquireHeavyCheckSlot('n', { schedule: sched.schedule }).then((r) => {
        granted++;
        return r;
      }),
    );
    await flush();
    expect(granted).toBe(2);
    expect(heavyCheckSlotStats()).toEqual({ active: 2, waiting: 1 });
    (await all[0]!)();
    await flush();
    expect(granted).toBe(3);
  });

  test('release is idempotent: calling it twice frees only one slot', async () => {
    process.env.RAPITAS_VERIFY_HEAVY_CONCURRENCY = '2';
    const r1 = await acquireHeavyCheckSlot('a');
    await acquireHeavyCheckSlot('b');
    r1();
    r1();
    expect(heavyCheckSlotStats().active).toBe(1);
  });

  test('two synchronous acquires: only one is granted (no await between check and update)', async () => {
    let resolved = 0;
    acquireHeavyCheckSlot('a').then(() => resolved++);
    acquireHeavyCheckSlot('b').then(() => resolved++);
    expect(heavyCheckSlotStats()).toEqual({ active: 1, waiting: 1 });
    await flush();
    expect(resolved).toBe(1);
  });

  test('waiting past waitMs fails open: resolves without a slot and logs a warning', async () => {
    const sched = manualScheduler();
    const holder = await acquireHeavyCheckSlot('holder', { schedule: sched.schedule });
    let late: (() => void) | null = null;
    acquireHeavyCheckSlot('late', { schedule: sched.schedule, waitMs: 10 }).then((r) => {
      late = r;
    });
    sched.fireAll();
    await flush();
    expect(late).not.toBeNull();
    expect(warnings.some((w) => w.includes('wait limit'))).toBe(true);
    // The fail-open waiter never took a slot, so releasing it changes nothing.
    expect(heavyCheckSlotStats()).toEqual({ active: 1, waiting: 0 });
    late!();
    expect(heavyCheckSlotStats().active).toBe(1);
    holder();
    expect(heavyCheckSlotStats().active).toBe(0);
  });

  test('a release and the wait limit racing on the same waiter count only once', async () => {
    const sched = manualScheduler();
    const holder = await acquireHeavyCheckSlot('holder', { schedule: sched.schedule });
    const waiter = acquireHeavyCheckSlot('w', { schedule: sched.schedule, waitMs: 10 });
    holder(); // grants the slot to the waiter and cancels its timer
    sched.fireAll(); // the cancelled timer must not run
    (await waiter)();
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });
});

describe('withHeavyCheckSlot', () => {
  test('releases the slot when the wrapped check throws', async () => {
    await expect(
      withHeavyCheckSlot('boom', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });

  test('never runs two wrapped checks at once with the default limit', async () => {
    let running = 0;
    let peak = 0;
    const job = () =>
      withHeavyCheckSlot('job', async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      });
    await Promise.all([job(), job(), job()]);
    expect(peak).toBe(1);
  });
});

describe('safety exceptions reach the cycle log (task 1553 R7)', () => {
  test('a fail-open records verify.heavy_slot_fail_open once, with cause, label and waitedMs', async () => {
    const events: Array<{ evt: string; fields: Record<string, unknown> }> = [];
    setHeavySlotEventSinkForTests((evt, fields) => events.push({ evt, fields }));
    const sched = manualScheduler();
    const holder = await acquireHeavyCheckSlot('holder', { schedule: sched.schedule });
    const late = acquireHeavyCheckSlot('tsc x', { schedule: sched.schedule, waitMs: 10 });
    sched.fireAll();
    (await late)();
    expect(events.length).toBe(1);
    expect(events[0]!.evt).toBe('verify.heavy_slot_fail_open');
    expect(events[0]!.fields).toMatchObject({ cause: 'wait_limit_exceeded', label: 'tsc x' });
    expect(typeof events[0]!.fields.waitedMs).toBe('number');
    holder();
  });

  test('a normal acquire within the wait limit records nothing', async () => {
    const events: string[] = [];
    setHeavySlotEventSinkForTests((evt) => events.push(evt));
    const sched = manualScheduler();
    const holder = await acquireHeavyCheckSlot('holder', { schedule: sched.schedule });
    const next = acquireHeavyCheckSlot('tsc y', { schedule: sched.schedule, waitMs: 10 });
    holder();
    (await next)();
    sched.fireAll(); // the cancelled wait timer must not record
    expect(events).toEqual([]);
  });

  test('a throwing sink never breaks the fail-open', async () => {
    setHeavySlotEventSinkForTests(() => {
      throw new Error('log disk full');
    });
    const sched = manualScheduler();
    const holder = await acquireHeavyCheckSlot('holder', { schedule: sched.schedule });
    const late = acquireHeavyCheckSlot('tsc z', { schedule: sched.schedule, waitMs: 10 });
    sched.fireAll();
    expect(typeof (await late)).toBe('function');
    holder();
  });
});
