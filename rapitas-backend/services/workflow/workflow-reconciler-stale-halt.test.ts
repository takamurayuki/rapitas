/**
 * workflow-reconciler-stale-halt.test
 *
 * Nothing clears haltReason when a task finishes, so a task that halted once
 * and later completed keeps the columns forever. Measured 2026-10-07: 4 of the
 * 5 tasks holding a haltReason were already status=done
 * (#1031/#1060/#1110/#1112). These pin that the sweep only ever clears, only on
 * a task whose own status says it is terminal, and survives a bad row.
 */
import { describe, test, expect } from 'bun:test';
import { clearStaleHalts } from './workflow-reconciler-stale-halt';

describe('clearStaleHalts', () => {
  test('終了済タスクの halt をクリアし件数を返す', async () => {
    const cleared: number[] = [];
    const n = await clearStaleHalts({
      findStale: () =>
        Promise.resolve([
          { id: 1031, haltReason: 'budget_cost_exceeded' },
          { id: 1112, haltReason: 'budget_cost_exceeded' },
        ]),
      clear: (id) => {
        cleared.push(id);
        return Promise.resolve();
      },
    });
    expect(n).toBe(2);
    expect(cleared).toEqual([1031, 1112]);
  });

  test('対象が無ければ何もしない', async () => {
    let called = false;
    const n = await clearStaleHalts({
      findStale: () => Promise.resolve([]),
      clear: () => {
        called = true;
        return Promise.resolve();
      },
    });
    expect(n).toBe(0);
    expect(called).toBe(false);
  });

  // Per-task isolation: one unwritable row must not starve the rest.
  test('1件が失敗しても残りを処理する', async () => {
    const n = await clearStaleHalts({
      findStale: () =>
        Promise.resolve([
          { id: 1, haltReason: 'x' },
          { id: 2, haltReason: 'y' },
          { id: 3, haltReason: 'z' },
        ]),
      clear: (id) => (id === 2 ? Promise.reject(new Error('locked')) : Promise.resolve()),
    });
    expect(n).toBe(2);
  });

  // A transient DB error must not throw into the reconciler's pass loop.
  test('検索が失敗しても例外を投げず 0 を返す', async () => {
    const n = await clearStaleHalts({
      findStale: () => Promise.reject(new Error('db down')),
      clear: () => Promise.resolve(),
    });
    expect(n).toBe(0);
  });
});
