/**
 * session-cost-sweep.test-helpers
 *
 * Structural fake DB shared by the sweep's resume and drain tests: counts
 * every call and can hold one read or write, then release or fail it.
 * Not used by production code.
 */
import type { sweepAllSessionTotals } from './session-cost-sweep';

/** A session's stored totals in the fake. */
export type Stored = { cost: number; tokens: number };
/** What every fake session stores before its repair. */
export const STALE: Stored = { cost: 1, tokens: 100 };
/** What the fake's usage rows add up to. */
export const GOOD: Stored = { cost: 1.5, tokens: 140 };

/** 'read' = the first comparison read (own rows), 'lastRead' = the final one (action tokens). */
export type Kind = 'read' | 'lastRead' | 'write';

/**
 * Sessions 1..n, all stale; every DB call is counted, one read or write can be held.
 *
 * @param n - Number of sessions / セッション数
 * @returns The fake db, its call state and stored totals / 偽の DB・呼び出し状態・保存値
 */
export function fakeDb(n: number) {
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
    /** Ends the held call with a DB error instead of releasing it. */
    fail: (_err: Error) => {},
  };
  const maybeHold = async (kind: Kind, id: number) => {
    if (state.hold?.kind !== kind || state.hold.id !== id) return;
    state.hold = null;
    state.held = true;
    await new Promise<void>((resolve, reject) => {
      state.release = resolve;
      state.fail = reject;
    });
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
        if (state.reads[state.reads.length - 1] !== id) {
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

/** The fake returned by {@link fakeDb}. */
export type Fake = ReturnType<typeof fakeDb>;

/**
 * View the fake as the sweep's DB type.
 *
 * @param f - The fake / 偽の DB
 * @returns The same object, typed for the sweep / 走査用に型付けした同じオブジェクト
 */
export const asSweepDb = (f: Fake) => f.db as unknown as Parameters<typeof sweepAllSessionTotals>[0];

/** Sweep options that make a test run without waiting. */
export const FAST = { batchSize: 2, pauseMs: 0, retryBaseMs: 1 };

/**
 * Resolve once `cond` holds, polling every millisecond.
 *
 * @param cond - Condition to wait for / 待つ条件
 */
export const until = async (cond: () => boolean) => {
  while (!cond()) await new Promise((r) => setTimeout(r, 1));
};

/**
 * Resolve after `ms`.
 *
 * @param ms - Delay / 待ち時間（ミリ秒）
 */
export const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
