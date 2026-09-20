/**
 * auto-run-execution-presence.test
 *
 * hasAnyExecution / taskNeverExecuted: 0 件・1 件・照会失敗(fail-closed)。
 */
import { describe, test, expect } from 'bun:test';
import { hasAnyExecution, taskNeverExecuted } from './auto-run-execution-presence';

function prismaReturning(row: { id: number } | null | Error) {
  return {
    agentExecution: {
      findFirst: () => (row instanceof Error ? Promise.reject(row) : Promise.resolve(row)),
    },
  } as never;
}

describe('auto-run-execution-presence', () => {
  test('実行が無ければ hasAnyExecution=false / taskNeverExecuted=true', async () => {
    expect(await hasAnyExecution(prismaReturning(null), 984)).toBe(false);
    expect(await taskNeverExecuted(prismaReturning(null), 984)).toBe(true);
  });

  test('実行が1件でもあれば未実行ではない', async () => {
    expect(await hasAnyExecution(prismaReturning({ id: 1 }), 984)).toBe(true);
    expect(await taskNeverExecuted(prismaReturning({ id: 1 }), 984)).toBe(false);
  });

  test('照会失敗は fail-closed（実行あり扱い＝backstop は有効のまま）', async () => {
    expect(await taskNeverExecuted(prismaReturning(new Error('db down')), 984)).toBe(false);
  });
});
