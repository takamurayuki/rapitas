/**
 * session-cost-sweep.resume.test
 *
 * Re-review4 (two P2s of the background sweep):
 * 1. Each boot restarted the sweep at id 0, so boots that kept ending before
 *    it finished never reached the higher ids. The position must survive the
 *    restart and wrap at the end, so every session is reached.
 * 2. Stopping only raised a flag: a repair whose read was in flight went on
 *    to recompute after the shutdown drain had returned (6 more DB calls in
 *    the review's mock). The drain must wait for the running stage, and once
 *    stopped the sweep must not issue another DB call.
 * Uses a structural fake DB that counts every call and can hold one.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { sweepAllSessionTotals, startBackgroundSessionSweep } from './session-cost-sweep';
import { createMemorySweepCursorStore } from './session-cost-sweep-cursor';
import { drainSessionRecomputesForShutdown } from './session-cost-recovery';
import { flushPendingSessionRecomputes } from './session-cost-totals';

type Stored = { cost: number; tokens: number };
const STALE: Stored = { cost: 1, tokens: 100 };
const GOOD: Stored = { cost: 1.5, tokens: 140 };

/** 'read' = the first comparison read (own rows), 'lastRead' = the final one (action tokens). */
type Kind = 'read' | 'lastRead' | 'write';

/** Sessions 1..n, all stale; every DB call is counted, one read or write can be held. */
function fakeDb(n: number) {
  const stored = new Map<number, Stored>();
  for (let id = 1; id <= n; id++) stored.set(id, { ...STALE });
  const state = {
    calls: 0,
    /** Sessions whose own rows were read, in first-read order (the recompute re-reads them). */
    reads: [] as number[],
    /** Called on the first own-row read of a session (lets a test stop the sweep there). */
    beforeRead: (_id: number) => {},
    hold: null as null | { kind: Kind; id: number },
    held: false,
    release: () => {},
  };
  const maybeHold = async (kind: Kind, id: number) => {
    if (state.hold?.kind !== kind || state.hold.id !== id) return;
    state.hold = null;
    state.held = true;
    await new Promise<void>((r) => (state.release = r));
  };
  const db = {
    agentSession: {
      async findMany(args: { where: { id: { gt: number; lte?: number } }; take: number }) {
        state.calls++;
        const { gt, lte } = args.where.id;
        return [...stored.keys()]
          .sort((a, b) => a - b)
          .filter((id) => id > gt && (lte === undefined || id <= lte))
          .slice(0, args.take)
          .map((id) => ({
            id,
            totalCostUsd: stored.get(id)!.cost,
            totalTokensUsed: stored.get(id)!.tokens,
          }));
      },
      async updateMany(args: {
        where: { id: number };
        data: { totalCostUsd: number; totalTokensUsed: number };
      }) {
        state.calls++;
        await maybeHold('write', args.where.id);
        stored.set(args.where.id, { cost: args.data.totalCostUsd, tokens: args.data.totalTokensUsed });
        return { count: 1 };
      },
      async update() {
        state.calls++;
        return {};
      },
    },
    agentExecution: {
      async findMany(args: { where: { sessionId?: number } }) {
        state.calls++;
        const id = args.where.sessionId;
        if (id === undefined) return [];
        if (state.reads.at(-1) !== id) {
          state.reads.push(id);
          state.beforeRead(id);
        }
        await maybeHold('read', id);
        return [
          { id: id * 10, sessionId: id, costUsd: 1.5, tokensUsed: 140, claudeSessionId: null, startedAt: new Date(0) },
        ];
      },
    },
    agentAction: {
      async findMany(args: { where: { sessionId: number } }) {
        state.calls++;
        await maybeHold('lastRead', args.where.sessionId);
        return [];
      },
    },
  };
  return { db, state, stored };
}
type Fake = ReturnType<typeof fakeDb>;
const asSweepDb = (f: Fake) => f.db as unknown as Parameters<typeof sweepAllSessionTotals>[0];
const FAST = { batchSize: 2, pauseMs: 0, retryBaseMs: 1 };
const until = async (cond: () => boolean) => {
  while (!cond()) await new Promise((r) => setTimeout(r, 1));
};
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  await drainSessionRecomputesForShutdown({ timeoutMs: 200 });
  await flushPendingSessionRecomputes();
});

describe('sweep position across restarts (re-review4 P2-1)', () => {
  test('starts after the persisted cursor, wraps to the start and resets it when done', async () => {
    const f = fakeDb(6);
    const cursorStore = createMemorySweepCursorStore(3);
    const res = await sweepAllSessionTotals(asSweepDb(f), { ...FAST, cursorStore });
    expect(f.state.reads).toEqual([4, 5, 6, 1, 2, 3]);
    expect(res).toMatchObject({ checked: 6, repaired: 6, completed: true });
    expect(cursorStore.read()).toBe(0);
    for (const s of f.stored.values()) expect(s).toEqual(GOOD);
  });

  /** One short boot: stopped when it reaches its (perBoot+1)-th session. */
  const shortBoot = async (f: Fake, cursorStore: ReturnType<typeof createMemorySweepCursorStore>, perBoot: number) => {
    const ac = new AbortController();
    let seen = 0;
    f.state.reads = [];
    f.state.beforeRead = () => {
      if (++seen > perBoot) ac.abort();
    };
    const res = await sweepAllSessionTotals(asSweepDb(f), { ...FAST, cursorStore, signal: ac.signal });
    return { res, done: f.state.reads.slice(0, perBoot) };
  };

  test('boots that each end early still move on and reach every session', async () => {
    const f = fakeDb(6);
    const cursorStore = createMemorySweepCursorStore();
    const boots: number[][] = [];
    for (let i = 0; i < 3; i++) {
      const { res, done } = await shortBoot(f, cursorStore, 2);
      expect(res.completed).toBe(false);
      boots.push(done);
    }
    expect(boots).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    for (const s of f.stored.values()) expect(s).toEqual(GOOD);
  });

  test('a short boot near the end wraps to the start and the next one continues from there', async () => {
    const f = fakeDb(6);
    const cursorStore = createMemorySweepCursorStore(5);
    const boots: number[][] = [];
    for (let i = 0; i < 3; i++) boots.push((await shortBoot(f, cursorStore, 2)).done);
    expect(boots).toEqual([
      [6, 1],
      [2, 3],
      [4, 5],
    ]);
    for (const s of f.stored.values()) expect(s).toEqual(GOOD);
  });
});

describe('stopping a running sweep (re-review4 P2-2)', () => {
  /** The review's repro: hold a stage of session 1, run the drain, then release it. */
  const startHeld = async (kind: Kind) => {
    const f = fakeDb(2);
    f.state.hold = { kind, id: 1 };
    const handle = startBackgroundSessionSweep(asSweepDb(f), {
      ...FAST,
      delayMs: 0,
      cursorStore: createMemorySweepCursorStore(),
    });
    await until(() => f.state.held);
    return { f, handle };
  };

  test('the drain waits for a held read; no DB call happens after it returns', async () => {
    const { f, handle } = await startHeld('read');
    let released = false;
    setTimeout(() => {
      released = true;
      f.state.release();
    }, 30);
    await drainSessionRecomputesForShutdown({ timeoutMs: 2_000 });
    expect(released).toBe(true);
    const callsAtDrainEnd = f.state.calls;
    expect((await handle.done).completed).toBe(false);
    await tick();
    expect(f.state.calls).toBe(callsAtDrainEnd);
    // Stopped after its read: neither written nor re-read.
    expect(f.stored.get(1)).toEqual(STALE);
    expect(f.state.reads).toEqual([1]);
  });

  test('a read released after the drain timed out issues no further DB call', async () => {
    const { f, handle } = await startHeld('read');
    await drainSessionRecomputesForShutdown({ timeoutMs: 30 });
    const callsAtDrainEnd = f.state.calls;
    f.state.release();
    await handle.done;
    await tick();
    expect(f.state.calls).toBe(callsAtDrainEnd);
    expect(f.stored.get(1)).toEqual(STALE);
  });

  test('a stop during the last comparison read skips the recompute', async () => {
    const { f, handle } = await startHeld('lastRead');
    await drainSessionRecomputesForShutdown({ timeoutMs: 30 });
    const callsAtDrainEnd = f.state.calls;
    f.state.release();
    await handle.done;
    await tick();
    expect(f.state.calls).toBe(callsAtDrainEnd);
    expect(f.stored.get(1)).toEqual(STALE);
  });

  test('the drain waits for a recompute already writing, and the sweep stops after it', async () => {
    const { f, handle } = await startHeld('write');
    let released = false;
    setTimeout(() => {
      released = true;
      f.state.release();
    }, 30);
    await drainSessionRecomputesForShutdown({ timeoutMs: 2_000 });
    expect(released).toBe(true);
    const callsAtDrainEnd = f.state.calls;
    await handle.done;
    await tick();
    expect(f.state.calls).toBe(callsAtDrainEnd);
    // The write in flight was finished and verified; session 2 was never read.
    expect(f.stored.get(1)).toEqual(GOOD);
    expect(f.state.reads).not.toContain(2);
  });
});
