/**
 * knowledge-reuse-comparison tests
 *
 * Absent or insufficient comparisons are never evidence; a newer methodVersion
 * supersedes the previous result without code changes.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createTimelineFake } from './testing/timeline-fake';

const fake = createTimelineFake();
mock.module('../memory/timeline', () => fake.module);
mock.module('../../config/database', () => ({ prisma: {} }));

const k = await import('./knowledge-reuse-comparison');

const base = {
  evalSetVersion: 'eval-2026-09',
  methodVersion: 'paired-v1',
  pairedN: 30,
  missingRetainedN: 4,
  successRateWithKB: 0.7,
  successRateWithoutKB: 0.6,
  effectSize: 0.1,
  intervalOrPValue: '[-0.05, 0.25]',
  sufficientEvidence: false,
};

beforeEach(() => {
  fake.rows.length = 0;
});

describe('readLatestKnowledgeReuseEval', () => {
  test('no comparison event is insufficient', async () => {
    const r = await k.readLatestKnowledgeReuseEval();
    expect(r.sufficientEvidence).toBe(false);
    expect(r.latest).toBeNull();
  });

  test('sufficientEvidence=false is insufficient and keeps missing cases visible', async () => {
    await k.recordKnowledgeReuseEval(base);
    const r = await k.readLatestKnowledgeReuseEval();
    expect(r.sufficientEvidence).toBe(false);
    expect(r.latest?.missingRetainedN).toBe(4);
  });

  test('sufficientEvidence=true from a newer methodVersion supersedes the older result', async () => {
    await k.recordKnowledgeReuseEval(base);
    fake.setNow(new Date(fake.now().getTime() + 60_000));
    await k.recordKnowledgeReuseEval({
      ...base,
      methodVersion: 'paired-v2',
      sufficientEvidence: true,
    });
    const r = await k.readLatestKnowledgeReuseEval();
    expect(r.sufficientEvidence).toBe(true);
    expect(r.latest?.methodVersion).toBe('paired-v2');
  });
});

describe('assessKnowledgeReuseEvidence', () => {
  test('a claimed-sufficient result without both success rates is insufficient', () => {
    expect(
      k.assessKnowledgeReuseEvidence({
        ...base,
        schemaVersion: 1,
        sufficientEvidence: true,
        successRateWithoutKB: null,
      }),
    ).toBe(false);
  });

  test('recording an invalid payload throws instead of storing it', async () => {
    await expect(k.recordKnowledgeReuseEval({ ...base, evalSetVersion: '' })).rejects.toThrow();
    expect(fake.rows).toHaveLength(0);
  });
});
