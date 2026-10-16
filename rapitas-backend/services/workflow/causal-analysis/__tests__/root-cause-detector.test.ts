/**
 * root-cause-detector tests
 *
 * Covers cascade detection, window boundary, control-cause exclusion and at-risk listing.
 */
import { describe, it, expect } from 'bun:test';
import {
  detectRootCauses,
  CAUSAL_WINDOW_MS,
  MIN_CASCADE_SIZE,
  type CausalQueueItem,
} from '../root-cause-detector';

const T0 = Date.parse('2026-10-06T00:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms);

function item(over: Partial<CausalQueueItem> & { taskId: number }): CausalQueueItem {
  return {
    status: 'failed',
    dependencies: '[]',
    queuedAt: at(0),
    startedAt: at(0),
    completedAt: at(1000),
    errorMessage: 'boom',
    ...over,
  };
}

const root = item({ taskId: 1, status: 'running', completedAt: null, errorMessage: null });
const failedChild = (id: number, offset: number, extra: Partial<CausalQueueItem> = {}) =>
  item({ taskId: id, dependencies: '[1]', completedAt: at(offset), ...extra });

describe('detectRootCauses', () => {
  it('exposes the MIN_CASCADE_SIZE constant as 2', () => {
    expect(MIN_CASCADE_SIZE).toBe(2);
  });

  it('proposes the stalled root with evidence, confidence and at-risk ids', () => {
    const res = detectRootCauses(
      [
        root,
        failedChild(2, 15 * 60_000),
        failedChild(3, 20 * 60_000),
        item({
          taskId: 4,
          status: 'queued',
          dependencies: '[1]',
          startedAt: null,
          completedAt: null,
          errorMessage: null,
        }),
      ],
      T0 + CAUSAL_WINDOW_MS + 60_000,
    );
    expect(res).toHaveLength(1);
    expect(res[0].taskId).toBe(1);
    expect([...res[0].downstreamFailedIds].sort()).toEqual([2, 3]);
    expect(res[0].atRiskIds).toEqual([4]);
    expect(res[0].confidence).toBeCloseTo(2 / 3, 5);
    expect(res[0].evidence).toContain('2');
  });

  it('counts a failure exactly at the window edge but not 1ms after', () => {
    const now = T0 + CAUSAL_WINDOW_MS * 2;
    const inside = detectRootCauses(
      [root, failedChild(2, CAUSAL_WINDOW_MS), failedChild(3, CAUSAL_WINDOW_MS)],
      now,
    );
    expect(inside).toHaveLength(1);
    const outside = detectRootCauses(
      [root, failedChild(2, CAUSAL_WINDOW_MS + 1), failedChild(3, CAUSAL_WINDOW_MS + 1)],
      now,
    );
    expect(outside).toEqual([]);
  });

  it('ignores a single downstream failure', () => {
    expect(detectRootCauses([root, failedChild(2, 1000)], T0 + CAUSAL_WINDOW_MS)).toEqual([]);
  });

  it('does not count halt-side (control) failures as cascade members', () => {
    const res = detectRootCauses(
      [
        root,
        failedChild(2, 1000, { errorMessage: 'iteration_budget_halted' }),
        failedChild(3, 1000, { errorMessage: 'auto_run_hang_backstop' }),
      ],
      T0 + CAUSAL_WINDOW_MS,
    );
    expect(res).toEqual([]);
  });

  it('does not blame a healthy completed root', () => {
    const healthy = item({ taskId: 1, status: 'completed', errorMessage: null });
    const res = detectRootCauses(
      [healthy, failedChild(2, 1000), failedChild(3, 1000)],
      T0 + 60_000,
    );
    expect(res).toEqual([]);
  });

  it('returns empty for empty input and survives cyclic dependencies', () => {
    expect(detectRootCauses([], T0)).toEqual([]);
    const a = item({ taskId: 1, dependencies: '[2]' });
    const b = item({ taskId: 2, dependencies: '[1]' });
    expect(() => detectRootCauses([a, b], T0 + 60_000)).not.toThrow();
  });

  it('does not blame the root for dependents that failed before it was in trouble', () => {
    const res = detectRootCauses(
      [root, failedChild(2, 60_000), failedChild(3, 120_000)],
      T0 + CAUSAL_WINDOW_MS + 60_000,
    );
    expect(res).toEqual([]);
  });

  it('does not blame a long-running root before it has stalled for SLOW_ROOT_MS', () => {
    const res = detectRootCauses(
      [root, failedChild(2, 15 * 60_000), failedChild(3, 20 * 60_000)],
      T0 + 5 * 60_000,
    );
    expect(res).toEqual([]);
  });

  it('computes confidence only over dependents that have queue rows', () => {
    const res = detectRootCauses(
      [
        root,
        failedChild(2, 15 * 60_000),
        failedChild(3, 20 * 60_000),
        item({ taskId: 9, dependencies: '[1, 8]', completedAt: at(15 * 60_000) }),
      ],
      T0 + CAUSAL_WINDOW_MS,
    );
    expect(res[0].confidence).toBe(1);
  });

  it('reports only the upstream root for a nested cascade (A -> B -> C,D)', () => {
    const a = item({ taskId: 1, status: 'failed', completedAt: at(1000) });
    const b = item({ taskId: 2, dependencies: '[1]', completedAt: at(2000) });
    const c = item({ taskId: 3, dependencies: '[2]', completedAt: at(3000) });
    const d = item({ taskId: 4, dependencies: '[2]', completedAt: at(4000) });
    const res = detectRootCauses([a, b, c, d], T0 + 60_000);
    expect(res.map((r) => r.taskId)).toEqual([1]);
  });
});
