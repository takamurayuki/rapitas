/**
 * session-cost-recovery.test
 *
 * The deferred retry of session-cost-totals lives in process memory, so a
 * restart between a stale totals write and its repair used to leave the
 * stale total until the session's next usage (re-re-review P2). Startup
 * recovery must put it right from the usage rows alone, and the shutdown
 * drain must run the pending retries before the process exits.
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
  recomputeSessionTotals,
  flushPendingSessionRecomputes,
  pendingSessionRecomputeCount,
  type SessionTotalsDb,
} from './session-cost-totals';
import {
  recoverSessionTotals,
  drainSessionRecomputesForShutdown,
  RECOVERY_WINDOW_MS,
  flushPendingRecoveryRuns,
  pendingRecoveryRunCount,
  type SessionRecoveryDb,
} from './session-cost-recovery';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-session-recovery-'));
const dbPath = join(dir, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
const base = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

// Fails exactly one later action-row read, i.e. a recompute's verification read.
let failNextActionRead = false;
const db = base.$extends({
  query: {
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
const asDb = () => db as unknown as SessionTotalsDb & SessionRecoveryDb;

afterAll(async () => {
  await base.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const BOOT = new Date('2026-11-10T09:00:00Z');
const before = (ms: number) => new Date(BOOT.getTime() - ms);
const HOUR = 3_600_000;
let configId = 0;

beforeEach(async () => {
  failNextActionRead = false;
  await flushPendingSessionRecomputes();
  await flushPendingRecoveryRuns();
  await base.agentAction.deleteMany();
  await base.agentExecution.deleteMany();
  await base.agentSession.deleteMany();
  await base.developerModeConfig.deleteMany();
  await base.task.deleteMany();
  const task = await base.task.create({ data: { title: 't' } });
  configId = (await base.developerModeConfig.create({ data: { taskId: task.id } })).id;
});

/** A session whose usage rows imply 1.5/140 but whose stored totals are `stored`, last written at `writtenAt`. */
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

const row = async (id: number) => {
  const s = await base.agentSession.findUniqueOrThrow({ where: { id } });
  return { cost: Number(s.totalCostUsd), tokens: s.totalTokensUsed, updatedAt: s.updatedAt };
};
const totalsOf = async (id: number) => {
  const { cost, tokens } = await row(id);
  return { cost, tokens };
};

describe('recoverSessionTotals (startup)', () => {
  test('a stale total left by a restart is repaired from the usage rows (re-re-review P2)', async () => {
    // The process died after writing the older 1/100: the rows are right, the
    // in-memory retry is gone (nothing pending), no further usage arrives.
    const s = await sessionWith({ cost: 1, tokens: 100 }, before(60_000));
    expect(pendingSessionRecomputeCount()).toBe(0);
    const res = await recoverSessionTotals(asDb(), { bootTime: BOOT });
    expect(res).toEqual({ checked: 1, repaired: 1 });
    expect(await totalsOf(s)).toEqual({ cost: 1.5, tokens: 140 });
  });

  test('anchors the window on the last write before boot, not on boot time (long downtime)', async () => {
    const s = await sessionWith({ cost: 1, tokens: 100 }, before(72 * HOUR));
    await recoverSessionTotals(asDb(), { bootTime: BOOT });
    expect(await totalsOf(s)).toEqual({ cost: 1.5, tokens: 140 });
  });

  test('a session already matching its rows is not rewritten (updatedAt untouched)', async () => {
    const s = await sessionWith({ cost: 1.5, tokens: 140 }, before(60_000));
    const was = (await row(s)).updatedAt.getTime();
    const res = await recoverSessionTotals(asDb(), { bootTime: BOOT });
    expect(res).toEqual({ checked: 1, repaired: 0 });
    expect((await row(s)).updatedAt.getTime()).toBe(was);
  });

  test('scope: sessions last written more than the window before the latest write are not read', async () => {
    const recent = await sessionWith({ cost: 1, tokens: 100 }, before(60_000));
    const old = await sessionWith({ cost: 1, tokens: 100 }, before(60_000 + RECOVERY_WINDOW_MS + 1));
    const res = await recoverSessionTotals(asDb(), { bootTime: BOOT });
    expect(res).toEqual({ checked: 1, repaired: 1 });
    expect(await totalsOf(recent)).toEqual({ cost: 1.5, tokens: 140 });
    expect(await totalsOf(old)).toEqual({ cost: 1, tokens: 100 });
  });

  test('no sessions: nothing to do', async () => {
    expect(await recoverSessionTotals(asDb(), { bootTime: BOOT })).toEqual({
      checked: 0,
      repaired: 0,
    });
  });

  test('a failed comparison read hands the session to the deferred retry (re-review3 P2)', async () => {
    // Review repro: the recovery's own read of the stale session fails once.
    // It used to be logged and skipped: totals stayed 1/100, nothing pending.
    const s = await sessionWith({ cost: 1, tokens: 100 }, before(60_000));
    failNextActionRead = true;
    await recoverSessionTotals(asDb(), { bootTime: BOOT });
    expect(pendingSessionRecomputeCount()).toBe(1);
    await flushPendingSessionRecomputes();
    expect(await totalsOf(s)).toEqual({ cost: 1.5, tokens: 140 });
  });

  test('a failed session-list read schedules a rerun of the whole recovery (re-review3 P2)', async () => {
    const s = await sessionWith({ cost: 1, tokens: 100 }, before(60_000));
    let failList = true;
    const flaky = {
      ...asDb(),
      agentSession: {
        ...asDb().agentSession,
        findMany: (args: Parameters<SessionRecoveryDb['agentSession']['findMany']>[0]) => {
          if (failList) {
            failList = false;
            return Promise.reject(new Error('list down'));
          }
          return asDb().agentSession.findMany(args);
        },
      },
    } as SessionTotalsDb & SessionRecoveryDb;
    await recoverSessionTotals(flaky, { bootTime: BOOT });
    expect(pendingRecoveryRunCount()).toBe(1);
    await flushPendingRecoveryRuns();
    expect(pendingRecoveryRunCount()).toBe(0);
    expect(await totalsOf(s)).toEqual({ cost: 1.5, tokens: 140 });
  });

  test('premise of the window: every totals write bumps updatedAt', async () => {
    const s = await sessionWith({ cost: 0, tokens: 0 }, new Date(0));
    await recomputeSessionTotals(asDb(), s);
    expect((await row(s)).updatedAt.getTime()).toBeGreaterThan(Date.now() - HOUR);
  });
});

describe('drainSessionRecomputesForShutdown', () => {
  test('runs a pending retry before exit', async () => {
    const s = await sessionWith({ cost: 0, tokens: 0 }, before(1000));
    // First action read is the initial one; the second (verification) fails.
    let reads = 0;
    const flaky = {
      ...asDb(),
      agentAction: {
        findMany: (args: Parameters<SessionTotalsDb['agentAction']['findMany']>[0]) => {
          if (++reads === 2) failNextActionRead = true;
          return asDb().agentAction.findMany(args);
        },
      },
    } as SessionTotalsDb;
    await expect(recomputeSessionTotals(flaky, s)).rejects.toThrow('transient read failure');
    expect(pendingSessionRecomputeCount()).toBe(1);
    await drainSessionRecomputesForShutdown({ timeoutMs: 2000 });
    expect(pendingSessionRecomputeCount()).toBe(0);
    expect(await totalsOf(s)).toEqual({ cost: 1.5, tokens: 140 });
  });

  test('returns within its time budget even when a retry never settles', async () => {
    const s = await sessionWith({ cost: 0, tokens: 0 }, before(1000));
    // First read fails (so a retry is pending); the retry's read then hangs
    // until released, standing in for a DB that never answers.
    let first = true;
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const real = asDb().agentExecution;
    const stuck = {
      ...asDb(),
      agentExecution: {
        findMany: async (args: Parameters<SessionTotalsDb['agentExecution']['findMany']>[0]) => {
          if (first) {
            first = false;
            throw new Error('down');
          }
          await released;
          return real.findMany(args);
        },
      },
    } as SessionTotalsDb;
    await expect(recomputeSessionTotals(stuck, s)).rejects.toThrow('down');
    const started = Date.now();
    await drainSessionRecomputesForShutdown({ timeoutMs: 100 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(pendingSessionRecomputeCount()).toBe(1);
    // Let the stuck retry finish so no job outlives this file.
    release();
    await flushPendingSessionRecomputes();
    expect(await totalsOf(s)).toEqual({ cost: 1.5, tokens: 140 });
  });
});
