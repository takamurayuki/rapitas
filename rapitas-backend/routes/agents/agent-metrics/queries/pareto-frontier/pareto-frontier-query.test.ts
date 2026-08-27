/**
 * pareto-frontier-query unit tests
 *
 * Verifies segment splitting by workflow type x role, complexity-band and
 * role filters, exclusion of in-flight / role-less / model-less rows,
 * reliability gating, CI presence, the 30-day window passed to Prisma, and
 * the honest CPU/memory-unavailable descriptor.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const findMany = mock(() => Promise.resolve([] as unknown[]));
mock.module('../../../../../config/database', () => ({
  prisma: {
    agentExecution: { findMany },
  },
}));

import {
  buildParetoSegments,
  getParetoFrontier,
  monthlyVolume,
  toComplexityBand,
  toWorkflowType,
} from './pareto-frontier-query';
import type { ParetoExecutionRow } from './pareto-frontier-types';

/** Builds one execution row; defaults to a completed standard/implementer/sonnet row. */
function row(
  overrides: Partial<ParetoExecutionRow> & {
    score?: number | null;
    mode?: string | null;
    wf?: string | null;
  } = {},
): ParetoExecutionRow {
  const { score = 50, mode = 'workflow-implementer', wf = 'standard', ...rest } = overrides;
  return {
    status: 'completed',
    modelName: 'claude-sonnet-4-6',
    tokensUsed: 1000,
    costUsd: 0.5,
    executionTimeMs: 60_000,
    session: { mode, config: { task: { workflowMode: wf, complexityScore: score } } },
    ...rest,
  };
}

function repeat(n: number, factory: (i: number) => ParetoExecutionRow): ParetoExecutionRow[] {
  return Array.from({ length: n }, (_, i) => factory(i));
}

beforeEach(() => {
  findMany.mockReset();
  findMany.mockImplementation(() => Promise.resolve([]));
});

describe('toWorkflowType / toComplexityBand', () => {
  test('maps known modes and falls back to unknown', () => {
    expect(toWorkflowType('lightweight')).toBe('lightweight');
    expect(toWorkflowType('comprehensive')).toBe('comprehensive');
    expect(toWorkflowType(null)).toBe('unknown');
    expect(toWorkflowType('weird')).toBe('unknown');
  });

  test('bands complexity on the same thresholds as cost-optimization', () => {
    expect(toComplexityBand(0)).toBe('low');
    expect(toComplexityBand(35)).toBe('low');
    expect(toComplexityBand(36)).toBe('medium');
    expect(toComplexityBand(70)).toBe('medium');
    expect(toComplexityBand(71)).toBe('high');
    expect(toComplexityBand(null)).toBeNull();
  });
});

describe('buildParetoSegments', () => {
  test('splits curves by workflow type and role, one point per model', () => {
    const rows = [
      ...repeat(6, () => row({ wf: 'lightweight' })),
      ...repeat(6, () => row({ wf: 'standard' })),
      ...repeat(6, () => row({ wf: 'standard', modelName: 'claude-haiku-4-5' })),
      ...repeat(6, () => row({ wf: 'standard', mode: 'workflow-researcher' })),
    ];
    const segments = buildParetoSegments(rows, { complexityBand: 'all', role: 'all' });
    expect(segments.map((s) => `${s.workflowType}:${s.role}`)).toEqual([
      'lightweight:implementer',
      'standard:implementer',
      'standard:researcher',
    ]);
    const standardImpl = segments[1];
    expect(standardImpl.sampleSize).toBe(12);
    expect(standardImpl.points.map((p) => p.parameterSet.model).sort()).toEqual([
      'claude-haiku-4-5',
      'claude-sonnet-4-6',
    ]);
    expect(standardImpl.points[0].key).toBe(
      `implementer/${standardImpl.points[0].parameterSet.model}`,
    );
  });

  test('drops in-flight, role-less and model-less rows', () => {
    const rows = [
      ...repeat(5, () => row()),
      row({ status: 'running' }),
      row({ status: 'pending' }),
      row({ status: 'waiting_for_input' }),
      row({ mode: null }),
      row({ mode: 'single' }),
      row({ modelName: null }),
    ];
    const segments = buildParetoSegments(rows, { complexityBand: 'all', role: 'all' });
    expect(segments).toHaveLength(1);
    expect(segments[0].sampleSize).toBe(5);
  });

  test('applies the complexity-band and role filters', () => {
    const rows = [
      ...repeat(5, () => row({ score: 20 })),
      ...repeat(5, () => row({ score: 90 })),
      ...repeat(5, () => row({ score: 90, mode: 'workflow-verifier' })),
      row({ score: null }),
    ];
    const high = buildParetoSegments(rows, { complexityBand: 'high', role: 'all' });
    expect(high.map((s) => s.role).sort()).toEqual(['implementer', 'verifier']);
    expect(high.every((s) => s.sampleSize === 5)).toBe(true);

    const highVerifier = buildParetoSegments(rows, { complexityBand: 'high', role: 'verifier' });
    expect(highVerifier).toHaveLength(1);
    expect(highVerifier[0].role).toBe('verifier');

    const all = buildParetoSegments(rows, { complexityBand: 'all', role: 'implementer' });
    expect(all).toHaveLength(1);
    expect(all[0].sampleSize).toBe(11);
  });

  test('computes success rate, time and cost with confidence intervals', () => {
    const rows = [
      ...repeat(9, (i) => row({ executionTimeMs: 50_000 + i * 1000, costUsd: 0.4 })),
      row({
        status: 'failed',
        executionTimeMs: 0,
        costUsd: 0.1,
        errorMessage: 'x',
      } as Partial<ParetoExecutionRow>),
    ];
    const [segment] = buildParetoSegments(rows, { complexityBand: 'all', role: 'all' });
    const [pt] = segment.points;
    expect(pt.sampleSize).toBe(10);
    expect(pt.successCount).toBe(9);
    expect(pt.successRate.value).toBe(90);
    expect(pt.successRate.ciLow).toBeLessThan(90);
    expect(pt.successRate.ciHigh).toBeGreaterThan(90);
    // Only the nine rows with a recorded duration feed the time distribution.
    expect(pt.executionTimeMs.value).toBe(54_000);
    expect(pt.executionTimeMs.ciLow).toBeLessThan(54_000);
    expect(pt.costUsd.value).toBeCloseTo(0.37, 4);
    expect(pt.avgTokens).toBe(1000);
    expect(pt.reliable).toBe(true);
    expect(pt.paretoOptimal).toBe(true);
    expect(segment.baseline.successRate.value).toBe(90);
  });

  test('flags points below the sample threshold as unreliable and never optimal', () => {
    const rows = [
      ...repeat(8, () => row()),
      ...repeat(2, () =>
        row({ modelName: 'claude-opus-4-6', executionTimeMs: 1000, costUsd: 0.01 }),
      ),
    ];
    const [segment] = buildParetoSegments(rows, { complexityBand: 'all', role: 'all' });
    const opus = segment.points.find((p) => p.parameterSet.model === 'claude-opus-4-6');
    const sonnet = segment.points.find((p) => p.parameterSet.model === 'claude-sonnet-4-6');
    expect(opus?.reliable).toBe(false);
    expect(opus?.paretoOptimal).toBe(false);
    expect(sonnet?.paretoOptimal).toBe(true);
  });

  test('marks the dominated model off the frontier', () => {
    const rows = [
      ...repeat(6, () => row({ modelName: 'good', executionTimeMs: 10_000, costUsd: 0.1 })),
      ...repeat(6, () => row({ modelName: 'worse', executionTimeMs: 20_000, costUsd: 0.2 })),
    ];
    const [segment] = buildParetoSegments(rows, { complexityBand: 'all', role: 'all' });
    expect(segment.points.find((p) => p.parameterSet.model === 'good')?.paretoOptimal).toBe(true);
    expect(segment.points.find((p) => p.parameterSet.model === 'worse')?.paretoOptimal).toBe(false);
  });
});

describe('getParetoFrontier', () => {
  test('queries the trailing window and reports the honest metrics descriptor', async () => {
    findMany.mockImplementation(() => Promise.resolve(repeat(5, () => row())));
    const before = Date.now();
    const result = await getParetoFrontier({ windowDays: 30, complexityBand: 'all', role: 'all' });

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = (findMany.mock.calls[0] as unknown[])[0] as {
      where: { createdAt: { gte: Date } };
      take: number;
    };
    const expectedFrom = before - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(args.where.createdAt.gte.getTime() - expectedFrom)).toBeLessThan(5000);
    expect(args.take).toBeGreaterThan(500);

    expect(result.windowDays).toBe(30);
    expect(result.totalExecutions).toBe(5);
    expect(result.segments).toHaveLength(1);
    expect(result.metrics).toEqual({
      resourceAxis: 'costUsd',
      cpuMemoryAvailable: false,
      confidenceLevel: 0.95,
      minReliableSamples: 5,
    });
    expect(result.filters).toEqual({ complexityBand: 'all', role: 'all' });
  });

  test('returns no segments when the window is empty', async () => {
    const result = await getParetoFrontier({ windowDays: 7, complexityBand: 'low', role: 'all' });
    expect(result.segments).toEqual([]);
    expect(result.totalExecutions).toBe(0);
  });
});

describe('monthlyVolume', () => {
  test('extrapolates window counts to 30 days', () => {
    expect(monthlyVolume(30, 30)).toBe(30);
    expect(monthlyVolume(10, 10)).toBe(30);
    expect(monthlyVolume(7, 14)).toBe(15);
    expect(monthlyVolume(5, 0)).toBe(0);
  });
});
