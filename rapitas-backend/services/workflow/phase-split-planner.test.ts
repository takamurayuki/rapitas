/**
 * phase-split-planner tests
 *
 * Verifies the pure overflow-detection and semantic phase-split logic.
 */
import { describe, expect, test } from 'bun:test';
import type { ContextMetrics, SectionMetric } from './workflow-context-metrics';
import { DEFAULT_PHASE_SPLIT_TOKEN_LIMIT, planPhaseSplit } from './phase-split-planner';

function section(name: string, estTokens: number): SectionMetric {
  return { name, chars: estTokens * 4, estTokens };
}

function metricsOf(sections: SectionMetric[]): ContextMetrics {
  return {
    sections,
    totalChars: sections.reduce((sum, s) => sum + s.chars, 0),
    totalEstTokens: sections.reduce((sum, s) => sum + s.estTokens, 0),
  };
}

describe('planPhaseSplit — no overflow', () => {
  test('returns exceedsLimit=false and a single phase with all sections', () => {
    const metrics = metricsOf([section('taskInfo', 1_000), section('plan', 2_000)]);
    const result = planPhaseSplit(metrics, 10_000);

    expect(result.exceedsLimit).toBe(false);
    expect(result.totalEstTokens).toBe(3_000);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]).toEqual({
      index: 1,
      sectionNames: ['taskInfo', 'plan'],
      estTokens: 3_000,
    });
  });

  test('empty sections produce no phases', () => {
    const result = planPhaseSplit(metricsOf([]), 10_000);
    expect(result.exceedsLimit).toBe(false);
    expect(result.totalEstTokens).toBe(0);
    expect(result.phases).toEqual([]);
  });

  test('uses the default 200,000 token limit when unset', () => {
    const metrics = metricsOf([section('research', 199_999)]);
    const result = planPhaseSplit(metrics);
    expect(result.limitTokens).toBe(DEFAULT_PHASE_SPLIT_TOKEN_LIMIT);
    expect(result.exceedsLimit).toBe(false);
  });
});

describe('planPhaseSplit — overflow', () => {
  test('splits sections into multiple phases along section boundaries', () => {
    const metrics = metricsOf([
      section('taskInfo', 3_000),
      section('research', 5_000),
      section('plan', 4_000),
      section('memory', 2_000),
    ]);
    const result = planPhaseSplit(metrics, 8_000);

    expect(result.exceedsLimit).toBe(true);
    expect(result.totalEstTokens).toBe(14_000);
    expect(result.phases).toEqual([
      { index: 1, sectionNames: ['taskInfo', 'research'], estTokens: 8_000 },
      { index: 2, sectionNames: ['plan', 'memory'], estTokens: 6_000 },
    ]);
  });

  test('preserves section order across phases', () => {
    const metrics = metricsOf([section('a', 5_000), section('b', 5_000), section('c', 5_000)]);
    const result = planPhaseSplit(metrics, 6_000);

    const orderedNames = result.phases.flatMap((p) => p.sectionNames);
    expect(orderedNames).toEqual(['a', 'b', 'c']);
  });

  test('a single section exceeding the limit alone still forms its own phase', () => {
    const metrics = metricsOf([section('diff', 250_000)]);
    const result = planPhaseSplit(metrics, 200_000);

    expect(result.exceedsLimit).toBe(true);
    expect(result.phases).toEqual([{ index: 1, sectionNames: ['diff'], estTokens: 250_000 }]);
  });
});

describe('planPhaseSplit — boundary values', () => {
  test('total exactly at the limit does not exceed', () => {
    const metrics = metricsOf([section('a', 5_000), section('b', 5_000)]);
    const result = planPhaseSplit(metrics, 10_000);

    expect(result.exceedsLimit).toBe(false);
    expect(result.phases).toHaveLength(1);
  });

  test('total one token over the limit exceeds and splits', () => {
    const metrics = metricsOf([section('a', 5_000), section('b', 5_001)]);
    const result = planPhaseSplit(metrics, 10_000);

    expect(result.exceedsLimit).toBe(true);
    expect(result.phases).toEqual([
      { index: 1, sectionNames: ['a'], estTokens: 5_000 },
      { index: 2, sectionNames: ['b'], estTokens: 5_001 },
    ]);
  });
});
