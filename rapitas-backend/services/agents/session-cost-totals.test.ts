/**
 * session-cost-totals.test
 *
 * AgentSession totals must equal real spend. Execution rows hold the Claude
 * CLI's session-CUMULATIVE cost/tokens, so the old "increment the session by
 * each saved value" counted every resume's history again. The recompute that
 * replaced it must (G2 review items 5–7):
 * - charge a resume under a NEW AgentSession only its increment,
 * - never let a recompute that read an older row set overwrite a newer total,
 * - keep usage recorded outside AgentExecution (AgentAction tokens).
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
  sessionTotalsFromRows,
  recomputeSessionTotals,
  updateSessionUsage,
  recordSessionActionUsage,
  type SessionTotalsDb,
} from './session-cost-totals';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-session-cost-'));
const dbPath = join(dir, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
const base = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

// Lets a test run a competing write between a recompute's read and its write.
let afterRowsRead: (() => Promise<void>) | undefined;
const db = base.$extends({
  query: {
    agentAction: {
      async findMany({ args, query }) {
        const rows = await query(args);
        const hook = afterRowsRead;
        afterRowsRead = undefined;
        await hook?.();
        return rows;
      },
    },
  },
});
const asDb = () => db as unknown as SessionTotalsDb;
const asActionDb = () => db as unknown as Parameters<typeof recordSessionActionUsage>[0];

afterAll(async () => {
  await base.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const t = (ms: number) => new Date(1_700_000_000_000 + ms);
let configId = 0;

beforeEach(async () => {
  await base.agentAction.deleteMany();
  await base.agentExecution.deleteMany();
  await base.agentSession.deleteMany();
  await base.developerModeConfig.deleteMany();
  await base.task.deleteMany();
  const task = await base.task.create({ data: { title: 't' } });
  configId = (await base.developerModeConfig.create({ data: { taskId: task.id } })).id;
});

const newSession = async () =>
  (await base.agentSession.create({ data: { configId, lastActivityAt: t(0) } })).id;

const exec = (
  sessionId: number,
  costUsd: number,
  tokensUsed: number,
  claudeSessionId: string | null,
  startedAt: Date,
) =>
  base.agentExecution.create({
    data: {
      sessionId,
      command: 'execute',
      status: 'completed',
      costUsd,
      tokensUsed,
      claudeSessionId,
      startedAt,
    },
  });

const totals = async (id: number) => {
  const s = await base.agentSession.findUniqueOrThrow({ where: { id } });
  return { cost: Number(s.totalCostUsd), tokens: s.totalTokensUsed };
};

describe('sessionTotalsFromRows (pure)', () => {
  test('a resumed CLI session counts its cumulative total once (measured 0.00257 → 0.00456)', () => {
    expect(
      sessionTotalsFromRows([
        { costUsd: 0.00257, tokensUsed: 100, claudeSessionId: 's1', startedAt: t(0) },
        { costUsd: 0.00456, tokensUsed: 180, claudeSessionId: 's1', startedAt: t(1) },
      ]),
    ).toEqual({ totalCostUsd: 0.00456, totalTokensUsed: 180 });
  });

  test('rows of other sessions only set the chain start; extra tokens are added', () => {
    expect(
      sessionTotalsFromRows(
        [
          {
            sessionId: 1,
            costUsd: 0.00257,
            tokensUsed: 100,
            claudeSessionId: 's1',
            startedAt: t(0),
          },
          {
            sessionId: 2,
            costUsd: 0.00456,
            tokensUsed: 180,
            claudeSessionId: 's1',
            startedAt: t(1),
          },
        ],
        { sessionId: 2, extraTokens: 7 },
      ),
    ).toEqual({ totalCostUsd: 0.00199, totalTokensUsed: 87 });
  });

  test('Decimal-like and double-encoded values are coerced', () => {
    const r = sessionTotalsFromRows([
      { costUsd: '"0.5"', tokensUsed: 10, claudeSessionId: null, startedAt: null },
      {
        costUsd: { toString: () => '0.25' },
        tokensUsed: null,
        claudeSessionId: null,
        startedAt: null,
      },
    ]);
    expect(r).toEqual({ totalCostUsd: 0.75, totalTokensUsed: 10 });
  });
});

describe('recomputeSessionTotals (real SQLite)', () => {
  test('writes absolute totals; jury cost rows (no CLI id) are plain spend', async () => {
    const s = await newSession();
    await exec(s, 1.0, 1000, 'c1', t(1));
    await exec(s, 1.5, 1400, 'c1', t(2));
    await exec(s, 0.1, 50, null, t(3));
    expect(await recomputeSessionTotals(asDb(), s)).toBe(true);
    expect(await totals(s)).toEqual({ cost: 1.6, tokens: 1450 });
  });

  test('a resume under a DIFFERENT AgentSession is charged only its increment (item 6)', async () => {
    // Workflow phases each get a new AgentSession but may --resume the same
    // claudeSessionId: 0.00257 in phase 1, cumulative 0.00456 in phase 2.
    const phase1 = await newSession();
    const phase2 = await newSession();
    await exec(phase1, 0.00257, 100, 'cli-1', t(1));
    await exec(phase2, 0.00456, 180, 'cli-1', t(2));
    await recomputeSessionTotals(asDb(), phase1);
    await recomputeSessionTotals(asDb(), phase2);
    expect(await totals(phase1)).toEqual({ cost: 0.00257, tokens: 100 });
    expect(await totals(phase2)).toEqual({ cost: 0.00199, tokens: 80 });
  });

  test('a recompute that read an older row set cannot overwrite a newer total (item 5)', async () => {
    const s = await newSession();
    await exec(s, 1.0, 100, null, t(1));
    // A (execution save) reads rows; before it writes, B (a jury cost record)
    // inserts a row and finishes its own recompute. A then tries to write its
    // older total — the order the review described.
    afterRowsRead = async () => {
      await exec(s, 0.5, 40, null, t(2));
      await recomputeSessionTotals(asDb(), s);
    };
    await recomputeSessionTotals(asDb(), s);
    expect(await totals(s)).toEqual({ cost: 1.5, tokens: 140 });
  });

  test('tokens recorded as AgentAction survive later recomputes (item 7)', async () => {
    const s = await newSession();
    await recordSessionActionUsage(asActionDb(), {
      sessionId: s,
      actionType: 'prompt_optimization',
      taskId: 1,
      tokensUsed: 300,
    });
    expect(await totals(s)).toEqual({ cost: 0, tokens: 300 });
    // A jury cost row lands in this (newest) session and recomputes.
    await exec(s, 0.2, 50, null, t(1));
    await recomputeSessionTotals(asDb(), s);
    expect(await totals(s)).toEqual({ cost: 0.2, tokens: 350 });
  });

  test('a missing session is a no-op', async () => {
    expect(await recomputeSessionTotals(asDb(), 999_999)).toBe(false);
  });
});

describe('updateSessionUsage', () => {
  test('keeps the LLM call count as an increment and recomputes cost/tokens', async () => {
    const s = await newSession();
    await exec(s, 2, 20, 'c', t(1));
    await exec(s, 3, 30, 'c', t(2));
    await updateSessionUsage(asDb(), s, { incLlmCalls: 2, recompute: true });
    await updateSessionUsage(asDb(), s, { incLlmCalls: 1, recompute: false });
    const row = await base.agentSession.findUniqueOrThrow({ where: { id: s } });
    expect(row.totalLlmCallCount).toBe(3);
    expect(await totals(s)).toEqual({ cost: 3, tokens: 30 });
  });
});
