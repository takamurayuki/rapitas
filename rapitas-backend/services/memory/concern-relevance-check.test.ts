/**
 * concern-relevance-check.test
 *
 * Locks the fail-open/confidence-gating contract: only a confident verdict
 * (>=threshold either way) returns a real answer; an unconfigured Jev, a
 * Jev error, or a near-0.5 answer must all return null so submitConcern's
 * existing filing pipeline runs unchanged.
 */
import { describe, it, test, expect, mock } from 'bun:test';

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLog, logger: noopLog }));

let askJevBooleanMock = mock(async () => null as Array<{ id: string; probability: number }> | null);
let isJevConfiguredMock = mock(() => true);
mock.module('../ai/jev-client', () => ({
  askJevBoolean: (...args: unknown[]) =>
    (askJevBooleanMock as unknown as (...a: unknown[]) => unknown)(...args),
  isJevConfigured: () => isJevConfiguredMock(),
}));

const { checkConcernStillRelevant } = await import('./concern-relevance-check');

describe('checkConcernStillRelevant', () => {
  it('returns null immediately (never calls Jev) when not configured', async () => {
    isJevConfiguredMock = mock(() => false);
    askJevBooleanMock = mock(async () => {
      throw new Error('must not be called');
    });
    const result = await checkConcernStillRelevant({ title: 't', detail: 'd' });
    expect(result).toBeNull();
  });

  it('returns relevant:true on a confident high probability', async () => {
    isJevConfiguredMock = mock(() => true);
    askJevBooleanMock = mock(async () => [{ id: 'still_relevant', probability: 0.93 }]);
    const result = await checkConcernStillRelevant({ title: 't', detail: 'd' });
    expect(result).toEqual({ relevant: true, confidence: 0.93 });
  });

  it('returns relevant:false on a confident low probability', async () => {
    isJevConfiguredMock = mock(() => true);
    askJevBooleanMock = mock(async () => [{ id: 'still_relevant', probability: 0.04 }]);
    const result = await checkConcernStillRelevant({ title: 't', detail: 'd' });
    expect(result).toEqual({ relevant: false, confidence: 0.96 });
  });

  test.each([
    ['a near-0.5 (inconclusive) probability', [{ id: 'still_relevant', probability: 0.55 }]],
    ['Jev itself returning null (unavailable/error)', null],
    ['the answer id missing from the response', [{ id: 'some_other_question', probability: 0.99 }]],
  ] as const)('returns null on %s', async (_label, jevAnswer) => {
    isJevConfiguredMock = mock(() => true);
    askJevBooleanMock = mock(async () => (jevAnswer ? [...jevAnswer] : jevAnswer));
    const result = await checkConcernStillRelevant({ title: 't', detail: 'd' });
    expect(result).toBeNull();
  });

  it('sends a context built from title and detail, capped in length', async () => {
    isJevConfiguredMock = mock(() => true);
    let capturedContext = '';
    askJevBooleanMock = mock(async (context: string) => {
      capturedContext = context;
      return [{ id: 'still_relevant', probability: 0.9 }];
    });
    const longDetail = 'x'.repeat(10_000);
    await checkConcernStillRelevant({ title: 'My Title', detail: longDetail });
    expect(capturedContext).toContain('My Title');
    expect(capturedContext.length).toBeLessThanOrEqual(4_000);
  });

  it('respects RAPITAS_JEV_RELEVANCE_THRESHOLD override', async () => {
    const prior = process.env.RAPITAS_JEV_RELEVANCE_THRESHOLD;
    process.env.RAPITAS_JEV_RELEVANCE_THRESHOLD = '0.6';
    try {
      isJevConfiguredMock = mock(() => true);
      askJevBooleanMock = mock(async () => [{ id: 'still_relevant', probability: 0.65 }]);
      const result = await checkConcernStillRelevant({ title: 't', detail: 'd' });
      expect(result).toEqual({ relevant: true, confidence: 0.65 });
    } finally {
      if (prior === undefined) delete process.env.RAPITAS_JEV_RELEVANCE_THRESHOLD;
      else process.env.RAPITAS_JEV_RELEVANCE_THRESHOLD = prior;
    }
  });
});
