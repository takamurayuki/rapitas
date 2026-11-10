/**
 * session-cost-totals.test
 *
 * AgentSession totals must equal real spend. Execution rows hold the Claude
 * CLI's session-CUMULATIVE cost/tokens, so the old "increment the session by
 * each saved value" counted every resume's history again.
 */
import { describe, expect, mock, test } from 'bun:test';
import {
  sessionTotalsFromRows,
  recomputeSessionTotals,
  updateSessionUsage,
  type SessionTotalsDb,
} from './session-cost-totals';

const t = (ms: number) => new Date(1_700_000_000_000 + ms);

describe('sessionTotalsFromRows', () => {
  test('a resumed CLI session counts its cumulative total once (measured 0.00257 → 0.00456)', () => {
    const totals = sessionTotalsFromRows([
      { costUsd: 0.00257, tokensUsed: 100, claudeSessionId: 's1', startedAt: t(0) },
      { costUsd: 0.00456, tokensUsed: 180, claudeSessionId: 's1', startedAt: t(1) },
    ]);
    // The old increment path recorded 0.00713 / 280 tokens for this session.
    expect(totals).toEqual({ totalCostUsd: 0.00456, totalTokensUsed: 180 });
  });

  test('rows without a CLI session id (e.g. jury cost rows) are plain spend', () => {
    const totals = sessionTotalsFromRows([
      { costUsd: 1.0, tokensUsed: 1000, claudeSessionId: 's1', startedAt: t(0) },
      { costUsd: 0.1, tokensUsed: 50, claudeSessionId: null, startedAt: t(1) },
      { costUsd: 0.2, tokensUsed: 70, claudeSessionId: null, startedAt: t(2) },
    ]);
    expect(totals).toEqual({ totalCostUsd: 1.3, totalTokensUsed: 1120 });
  });

  test('Decimal-like and double-encoded values are coerced', () => {
    const totals = sessionTotalsFromRows([
      { costUsd: '"0.5"', tokensUsed: 10, claudeSessionId: null, startedAt: null },
      {
        costUsd: { toString: () => '0.25' },
        tokensUsed: null,
        claudeSessionId: null,
        startedAt: null,
      },
    ]);
    expect(totals.totalCostUsd).toBe(0.75);
    expect(totals.totalTokensUsed).toBe(10);
  });
});

function fakeDb(rows: Awaited<ReturnType<SessionTotalsDb['agentExecution']['findMany']>>) {
  return {
    agentExecution: { findMany: mock(async () => rows) },
    agentSession: { update: mock(async () => ({})) },
  };
}

describe('recomputeSessionTotals / updateSessionUsage', () => {
  test('writes absolute totals, never an increment', async () => {
    const db = fakeDb([
      { costUsd: 2, tokensUsed: 20, claudeSessionId: 's', startedAt: t(0) },
      { costUsd: 3, tokensUsed: 30, claudeSessionId: 's', startedAt: t(1) },
    ]);
    await recomputeSessionTotals(db, 7);
    expect(db.agentSession.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ totalCostUsd: 3, totalTokensUsed: 30 }),
    });
  });

  test('keeps the LLM call count as an increment and skips the recompute when asked', async () => {
    const db = fakeDb([]);
    await updateSessionUsage(db, 7, { incLlmCalls: 2, recompute: false });
    expect(db.agentSession.update).toHaveBeenCalledTimes(1);
    expect(db.agentSession.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ totalLlmCallCount: { increment: 2 } }),
    });
    expect(db.agentExecution.findMany).not.toHaveBeenCalled();
  });
});
