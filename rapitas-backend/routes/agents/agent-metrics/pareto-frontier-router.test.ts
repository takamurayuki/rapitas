/**
 * pareto-frontier-router unit tests
 *
 * Verifies query-parameter parsing/clamping for the frontier options and
 * goal, plus the HTTP contract of both endpoints (success envelope, 400 on a
 * malformed goal) against a mocked query module.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const getParetoFrontier = mock(() => Promise.resolve({ segments: [] }));
const getParetoRecommendation = mock(() => Promise.resolve({ recommendations: [] }));
mock.module('./queries/pareto-frontier', () => ({
  getParetoFrontier,
  getParetoRecommendation,
}));

import { paretoFrontierRouter, parseFrontierOptions, parseGoal } from './pareto-frontier-router';

beforeEach(() => {
  getParetoFrontier.mockClear();
  getParetoRecommendation.mockClear();
});

describe('parseFrontierOptions', () => {
  test('defaults to a 30-day window with no filters', () => {
    expect(parseFrontierOptions({})).toEqual({
      windowDays: 30,
      complexityBand: 'all',
      role: 'all',
    });
  });

  test('clamps the window to 1-90 days and rejects unknown bands', () => {
    expect(parseFrontierOptions({ days: '0' }).windowDays).toBe(1);
    expect(parseFrontierOptions({ days: '400' }).windowDays).toBe(90);
    expect(parseFrontierOptions({ days: 'abc' }).windowDays).toBe(30);
    expect(parseFrontierOptions({ complexityBand: 'huge' }).complexityBand).toBe('all');
    expect(parseFrontierOptions({ complexityBand: 'high', role: ' verifier ' })).toEqual({
      windowDays: 30,
      complexityBand: 'high',
      role: 'verifier',
    });
  });
});

describe('parseGoal', () => {
  test('accepts the three goal kinds with a non-negative value', () => {
    expect(parseGoal({ goal: 'successRate', value: '95' })).toEqual({
      kind: 'successRate',
      value: 95,
    });
    expect(parseGoal({ goal: 'throughput', value: '20' })).toEqual({
      kind: 'throughput',
      value: 20,
    });
    expect(parseGoal({ goal: 'cost', value: '12.5' })).toEqual({ kind: 'cost', value: 12.5 });
  });

  test('rejects unknown kinds, missing/negative values and >100% success targets', () => {
    expect(parseGoal({ goal: 'latency', value: '1' })).toBeNull();
    expect(parseGoal({ goal: 'cost' })).toBeNull();
    expect(parseGoal({ goal: 'cost', value: '-1' })).toBeNull();
    expect(parseGoal({ goal: 'successRate', value: '101' })).toBeNull();
  });
});

describe('paretoFrontierRouter', () => {
  test('GET /pareto-frontier forwards parsed options and wraps the payload', async () => {
    const res = await paretoFrontierRouter.handle(
      new Request('http://localhost/pareto-frontier?days=14&complexityBand=low&role=planner'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { segments: [] } });
    expect(getParetoFrontier).toHaveBeenCalledWith({
      windowDays: 14,
      complexityBand: 'low',
      role: 'planner',
    });
  });

  test('GET /pareto-frontier/recommend returns 400 on a malformed goal', async () => {
    const res = await paretoFrontierRouter.handle(
      new Request('http://localhost/pareto-frontier/recommend?goal=nope&value=5'),
    );
    expect(res.status).toBe(400);
    expect(getParetoRecommendation).not.toHaveBeenCalled();
  });

  test('GET /pareto-frontier/recommend forwards options and goal', async () => {
    const res = await paretoFrontierRouter.handle(
      new Request('http://localhost/pareto-frontier/recommend?goal=successRate&value=95'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { recommendations: [] } });
    expect(getParetoRecommendation).toHaveBeenCalledWith(
      { windowDays: 30, complexityBand: 'all', role: 'all' },
      { kind: 'successRate', value: 95 },
    );
  });
});
