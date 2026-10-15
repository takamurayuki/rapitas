/**
 * failure-lineage routes unit tests
 *
 * `hours` parsing/validation (400 on invalid, no silent default) and the
 * HTTP envelope including `isEstimated` and the 500 path, against a mocked
 * service module.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const computeFailureLineage = mock((_hours: number) =>
  Promise.resolve({
    nodes: [],
    edges: [],
    clusters: [],
    rootCauseCandidates: [],
    validation: { matchRate: null },
    truncated: false,
    isEstimated: true as const,
    windowHours: 24,
  }),
);
mock.module('../../../services/failure-lineage', () => ({ computeFailureLineage }));

import { failureLineageRoutes, parseHours } from './failure-lineage.routes';

beforeEach(() => computeFailureLineage.mockClear());

describe('parseHours', () => {
  test('defaults to 24 and accepts the 1..168 bounds', () => {
    expect(parseHours(undefined)).toBe(24);
    expect(parseHours('1')).toBe(1);
    expect(parseHours('168')).toBe(168);
  });

  test('rejects out-of-range and non-integer values', () => {
    for (const bad of ['0', '169', '-1', 'abc', '1.5', '12h']) {
      expect(parseHours(bad)).toBeNull();
    }
  });
});

describe('GET /agents/failure-lineage', () => {
  test('returns the estimate with isEstimated: true', async () => {
    const res = await failureLineageRoutes.handle(
      new Request('http://localhost/agents/failure-lineage?hours=6'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.isEstimated).toBe(true);
    expect(computeFailureLineage).toHaveBeenCalledWith(6);
  });

  test('invalid hours -> 400 and the service is not called', async () => {
    const res = await failureLineageRoutes.handle(
      new Request('http://localhost/agents/failure-lineage?hours=999'),
    );
    expect(res.status).toBe(400);
    expect(computeFailureLineage).not.toHaveBeenCalled();
  });

  test('service failure -> 500 with no partial data', async () => {
    computeFailureLineage.mockImplementationOnce(() => Promise.reject(new Error('db down')));
    const res = await failureLineageRoutes.handle(
      new Request('http://localhost/agents/failure-lineage'),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.nodes).toBeUndefined();
  });
});
