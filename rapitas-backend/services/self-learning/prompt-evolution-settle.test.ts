/**
 * prompt-evolution-settle.test
 *
 * The settlement verdict and the approved-row lifecycle (stamp → measure →
 * complete/revert/skip) with an injected evaluator and a fake Prisma.
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../config/logger', () => {
  const noop = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noop,
    logger: noop,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const { decideSettlement, settleApprovedEvolutions } = await import('./prompt-evolution-settle');

describe('decideSettlement', () => {
  test('needs the minimum sample before any verdict', () => {
    expect(decideSettlement(0.5, { totalRuns: 4, successRate: 1 })).toEqual({
      verdict: 'insufficient',
      delta: 0,
    });
  });

  test('completes on improvement or a small dip, reverts on a real regression', () => {
    expect(decideSettlement(0.6, { totalRuns: 5, successRate: 0.8 })).toEqual({
      verdict: 'completed',
      delta: 0.2,
    });
    expect(decideSettlement(0.6, { totalRuns: 5, successRate: 0.58 }).verdict).toBe('completed');
    expect(decideSettlement(0.6, { totalRuns: 5, successRate: 0.5 })).toEqual({
      verdict: 'reverted',
      delta: -0.1,
    });
  });
});

describe('settleApprovedEvolutions', () => {
  const makePrisma = (
    rows: Array<{ id: number; basePromptKey: string; evidenceJson: string | null }>,
  ) => {
    const updates: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
    return {
      updates,
      prisma: {
        promptEvolution: {
          findMany: () => Promise.resolve(rows),
          update: (args: { where: { id: number }; data: Record<string, unknown> }) => {
            updates.push(args);
            return Promise.resolve(args);
          },
        },
      },
    };
  };
  const now = () => new Date('2026-09-06T05:00:00.000Z');

  test('stamps approvedAt on legacy rows instead of judging pre-approval sessions', async () => {
    const { prisma, updates } = makePrisma([
      { id: 1, basePromptKey: 'workflow_role_verifier', evidenceJson: '{"successRate":0.5}' },
    ]);
    const evaluate = mock(() => Promise.resolve({ totalRuns: 10, successRate: 0.9 }));
    const settled = await settleApprovedEvolutions(prisma, evaluate, now);
    expect(settled).toBe(0);
    expect(evaluate).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(JSON.parse(updates[0].data.evidenceJson as string).approvedAt).toBe(
      '2026-09-06T05:00:00.000Z',
    );
  });

  test('completes an addendum that improved the role and records the evidence', async () => {
    const { prisma, updates } = makePrisma([
      {
        id: 2,
        basePromptKey: 'workflow_role_implementer',
        evidenceJson: '{"successRate":0.6,"approvedAt":"2026-09-01T00:00:00.000Z"}',
      },
    ]);
    const evaluate = mock((_p: unknown, role: string, since: Date) => {
      expect(role).toBe('implementer');
      expect(since.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      return Promise.resolve({ totalRuns: 6, successRate: 0.8333 });
    });
    expect(await settleApprovedEvolutions(prisma, evaluate, now)).toBe(1);
    expect(updates[0].data.status).toBe('completed');
    expect(updates[0].data.performanceDelta).toBeCloseTo(0.2333, 3);
    const evidence = JSON.parse(updates[0].data.evidenceJson as string);
    expect(evidence.afterRuns).toBe(6);
    expect(evidence.beforeRate).toBe(0.6);
  });

  test('reverts an addendum that made the role worse', async () => {
    const { prisma, updates } = makePrisma([
      {
        id: 3,
        basePromptKey: 'workflow_role_planner',
        evidenceJson: '{"successRate":0.7,"approvedAt":"2026-09-01T00:00:00.000Z"}',
      },
    ]);
    await settleApprovedEvolutions(
      prisma,
      () => Promise.resolve({ totalRuns: 8, successRate: 0.5 }),
      now,
    );
    expect(updates[0].data.status).toBe('reverted');
  });

  test('leaves a row untouched while the sample is too small or evaluation fails', async () => {
    const { prisma, updates } = makePrisma([
      {
        id: 4,
        basePromptKey: 'workflow_role_researcher',
        evidenceJson: '{"successRate":0.5,"approvedAt":"2026-09-01T00:00:00.000Z"}',
      },
      {
        id: 5,
        basePromptKey: 'workflow_role_verifier',
        evidenceJson: '{"successRate":0.5,"approvedAt":"2026-09-01T00:00:00.000Z"}',
      },
    ]);
    const evaluate = (_p: unknown, role: string) =>
      role === 'researcher'
        ? Promise.resolve({ totalRuns: 2, successRate: 1 })
        : Promise.reject(new Error('db down'));
    expect(await settleApprovedEvolutions(prisma, evaluate, now)).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
