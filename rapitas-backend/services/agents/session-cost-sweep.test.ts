/**
 * session-cost-sweep.test
 *
 * Startup recovery only reads sessions written within a window of the last
 * pre-boot write. A session whose deferred retry kept failing at its read for
 * longer than that window never had its updatedAt bumped, so after a restart
 * it fell outside the window and stayed stale (re-review3 P2). The background
 * sweep must eventually read EVERY session, in paced batches that do not
 * weigh on the boot, and must hand any failure to a retry instead of
 * dropping it.
 * Runs against a real SQLite database built from the production init SQL.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';
import {
  flushPendingSessionRecomputes,
  pendingSessionRecomputeCount,
  type SessionTotalsDb,
} from './session-cost-totals';
import {
  sweepAllSessionTotals,
  startBackgroundSessionSweep,
  stopBackgroundSessionSweep,
  type SessionSweepDb,
} from './session-cost-sweep';
import { createMemorySweepCursorStore } from './session-cost-sweep-cursor';
import {
  runBootRecovery,
  drainSessionRecomputesForShutdown,
  RECOVERY_WINDOW_MS,
  type SessionRecoveryDb,
} from './session-cost-recovery';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-session-sweep-'));
const dbPath = join(dir, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
const base = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

// Counts the sweep's page reads; can fail exactly one of them, or one action read.
let pageReads = 0;
let failNextPage = false;
let failNextActionRead = false;
const db = base.$extends({
  query: {
    agentSession: {
      async findMany({ args, query }) {
        if ((args.where as { id?: unknown } | undefined)?.id !== undefined) {
          pageReads++;
          if (failNextPage) {
            failNextPage = false;
            throw new Error('page read failure');
          }
        }
        return query(args);
      },
    },
    agentAction: {
      async findMany({ args, query }) {
        if (failNextActionRead) {
          failNextActionRead = false;
          throw new Error('transient read failure');
        }
        return query(args);
      },
    },
  },
});
type AllDb = SessionTotalsDb & SessionRecoveryDb & SessionSweepDb;
const asDb = () => db as unknown as AllDb;

afterAll(async () => {
  stopBackgroundSessionSweep();
  await base.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const BOOT = new Date('2026-11-10T09:00:00Z');
const before = (ms: number) => new Date(BOOT.getTime() - ms);
// A fresh in-memory cursor per test, so no test touches the real data dir.
let FAST = {
  batchSize: 2,
  pauseMs: 0,
  retryBaseMs: 1,
  cursorStore: createMemorySweepCursorStore(),
};
let configId = 0;

beforeEach(async () => {
  await stopBackgroundSessionSweep();
  FAST = { ...FAST, cursorStore: createMemorySweepCursorStore() };
  pageReads = 0;
  failNextPage = false;
  failNextActionRead = false;
  await flushPendingSessionRecomputes();
  await base.agentAction.deleteMany();
  await base.agentExecution.deleteMany();
  await base.agentSession.deleteMany();
  await base.developerModeConfig.deleteMany();
  await base.task.deleteMany();
  const task = await base.task.create({ data: { title: 't' } });
  configId = (await base.developerModeConfig.create({ data: { taskId: task.id } })).id;
});

/** A session whose usage rows imply 1.5/140 but whose stored totals are `stored`. */
const sessionWith = async (stored: { cost: number; tokens: number }, writtenAt: Date) => {
  const id = (await base.agentSession.create({ data: { configId } })).id;
  for (const [cost, tokens, ms] of [
    [1.0, 100, 1],
    [0.5, 40, 2],
  ] as const) {
    await base.agentExecution.create({
      data: {
        sessionId: id,
        command: 'execute',
        status: 'completed',
        costUsd: cost,
        tokensUsed: tokens,
        startedAt: new Date(1_700_000_000_000 + ms),
      },
    });
  }
  await base.agentSession.update({
    where: { id },
    data: { totalCostUsd: stored.cost, totalTokensUsed: stored.tokens, updatedAt: writtenAt },
  });
  return id;
};
const STALE = { cost: 1, tokens: 100 };
const GOOD = { cost: 1.5, tokens: 140 };
const totalsOf = async (id: number) => {
  const s = await base.agentSession.findUniqueOrThrow({ where: { id } });
  return { cost: Number(s.totalCostUsd), tokens: s.totalTokensUsed };
};

/** The review's scenario: a stale session written long before the window of the latest write. */
const outOfWindowScenario = async () => {
  const recent = await sessionWith(GOOD, before(60_000));
  const old = await sessionWith(STALE, before(60_000 + RECOVERY_WINDOW_MS + 3_600_000));
  return { recent, old };
};

describe('sweepAllSessionTotals', () => {
  test('repairs a stale session outside the recovery window (re-review3 P2)', async () => {
    const { old } = await outOfWindowScenario();
    const res = await sweepAllSessionTotals(asDb(), FAST);
    expect(res).toEqual({ checked: 2, repaired: 1, deferred: 0, completed: true });
    expect(await totalsOf(old)).toEqual(GOOD);
  });

  test('reads every session in batches of batchSize', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push(await sessionWith(STALE, before(i * 1000)));
    const res = await sweepAllSessionTotals(asDb(), FAST);
    expect(res.checked).toBe(5);
    // 3 pages of ≤2 rows plus the empty page that ends the sweep.
    expect(pageReads).toBe(4);
    for (const id of ids) expect(await totalsOf(id)).toEqual(GOOD);
  });

  test('a failed page read is retried from the same cursor, not skipped', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) ids.push(await sessionWith(STALE, before(i * 1000)));
    failNextPage = true;
    const res = await sweepAllSessionTotals(asDb(), FAST);
    expect(res).toMatchObject({ checked: 3, repaired: 3, completed: true });
    for (const id of ids) expect(await totalsOf(id)).toEqual(GOOD);
  });

  test('a failed session read is handed to the deferred retry', async () => {
    const s = await sessionWith(STALE, before(1000));
    failNextActionRead = true;
    const res = await sweepAllSessionTotals(asDb(), FAST);
    expect(res).toMatchObject({ checked: 1, deferred: 1, completed: true });
    expect(pendingSessionRecomputeCount()).toBe(1);
    await flushPendingSessionRecomputes();
    expect(await totalsOf(s)).toEqual(GOOD);
  });

  test('stops between batches when aborted', async () => {
    for (let i = 0; i < 4; i++) await sessionWith(STALE, before(i * 1000));
    const ac = new AbortController();
    ac.abort();
    const res = await sweepAllSessionTotals(asDb(), { ...FAST, signal: ac.signal });
    expect(res.completed).toBe(false);
    expect(pageReads).toBe(0);
  });
});

describe('startBackgroundSessionSweep', () => {
  test('returns at once and reads nothing until its delay has passed', async () => {
    const s = await sessionWith(STALE, before(1000));
    const handle = startBackgroundSessionSweep(asDb(), { ...FAST, delayMs: 30 });
    expect(pageReads).toBe(0);
    expect(await handle.done).toMatchObject({ checked: 1, repaired: 1, completed: true });
    expect(await totalsOf(s)).toEqual(GOOD);
  });

  test('stopping before the delay reads nothing', async () => {
    await sessionWith(STALE, before(1000));
    const handle = startBackgroundSessionSweep(asDb(), { ...FAST, delayMs: 30 });
    stopBackgroundSessionSweep();
    expect((await handle.done).completed).toBe(false);
    expect(pageReads).toBe(0);
  });

  test('the shutdown drain stops a running sweep', async () => {
    await sessionWith(STALE, before(1000));
    const handle = startBackgroundSessionSweep(asDb(), { ...FAST, delayMs: 60_000 });
    await drainSessionRecomputesForShutdown({ timeoutMs: 500 });
    expect((await handle.done).completed).toBe(false);
    expect(pageReads).toBe(0);
  });
});

describe('runBootRecovery (two stages)', () => {
  test('repairs the window at once and leaves the rest to the delayed sweep', async () => {
    const { old } = await outOfWindowScenario();
    const recentStale = await sessionWith(STALE, before(30_000));
    const res = await runBootRecovery(asDb(), {
      bootTime: BOOT,
      sweep: { ...FAST, delayMs: 30 },
    });
    // Stage 1 (awaited by the boot): only the window, no full scan yet.
    expect(res).toMatchObject({ checked: 2, repaired: 1 });
    expect(await totalsOf(recentStale)).toEqual(GOOD);
    expect(await totalsOf(old)).toEqual(STALE);
    expect(pageReads).toBe(0);
    // Stage 2 (background): every session, including the one out of the window.
    expect((await res.sweep.done).completed).toBe(true);
    expect(await totalsOf(old)).toEqual(GOOD);
  });
});
