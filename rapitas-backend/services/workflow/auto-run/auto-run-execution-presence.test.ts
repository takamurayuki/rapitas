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

/** Fake that evaluates the where clause against rows of {createdAt, status}. */
function prismaWithRows(rows: Array<{ id: number; createdAt: Date; status: string }>) {
  return {
    agentExecution: {
      findFirst: ({ where }: { where: { OR?: Array<Record<string, unknown>> } }) => {
        const hit = rows.find((r) =>
          where.OR
            ? where.OR.some((c) => {
                const gte = (c.createdAt as { gte?: Date } | undefined)?.gte;
                return gte ? r.createdAt >= gte : c.status === r.status;
              })
            : true,
        );
        return Promise.resolve(hit ? { id: hit.id } : null);
      },
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

  describe('since (current tenure)', () => {
    const since = new Date('2026-10-09T01:00:00Z');
    const past = { id: 5514, createdAt: new Date('2026-10-08T13:55:00Z'), status: 'completed' };

    test('過去実行のみ（今回0件）は未実行扱い', async () => {
      expect(await taskNeverExecuted(prismaWithRows([past]), 1153, since)).toBe(true);
      // since 省略時は従来どおり全履歴を見る
      expect(await taskNeverExecuted(prismaWithRows([past]), 1153)).toBe(false);
    });

    test('今回の期間内に作られた実行があれば未実行ではない（境界 createdAt == since を含む）', async () => {
      const inside = { id: 1, createdAt: since, status: 'failed' };
      expect(await taskNeverExecuted(prismaWithRows([past, inside]), 1153, since)).toBe(false);
    });

    test('since より前に始まったが実行中のものは未実行ではない', async () => {
      const running = { id: 2, createdAt: new Date('2026-10-09T00:30:00Z'), status: 'running' };
      expect(await taskNeverExecuted(prismaWithRows([running]), 1153, since)).toBe(false);
    });
  });
});
