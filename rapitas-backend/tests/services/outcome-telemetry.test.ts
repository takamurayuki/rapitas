/**
 * outcome-telemetry テスト
 *
 * recentThemeEscalation: 直近の完了/ブロックタスクの「難航率」(blocked または
 * 修復遷移あり) からエスカレーションレベル(0/1/2)を導く。サンプル不足は0。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// HACK(agent): Bun mock型推論の制限 — `as any`
const taskFindMany = mock(() =>
  Promise.resolve([] as Array<{ id: number; status: string }>),
) as any;
const transitionFindMany = mock(() => Promise.resolve([] as Array<{ taskId: number }>)) as any;
const mockPrisma = {
  task: { findMany: taskFindMany, findUnique: mock(() => Promise.resolve(null)) as any },
  workflowTransition: {
    findMany: transitionFindMany,
    count: mock(() => Promise.resolve(0)) as any,
  },
  agentExecution: { findFirst: mock(() => Promise.resolve(null)) as any },
};
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => {
  const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
  return { createLogger: () => noop, logger: noop, getBackendLogFilePath: () => '/tmp/b.log' };
});
mock.module('../../services/memory/timeline', () => ({ appendEvent: () => Promise.resolve() }));

const { recentThemeEscalation } = await import('../../services/workflow/outcome-telemetry');

const tasks = (n: number, blocked = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, status: i < blocked ? 'blocked' : 'done' }));

beforeEach(() => {
  taskFindMany.mockReset();
  transitionFindMany.mockReset();
  transitionFindMany.mockResolvedValue([]);
});

describe('recentThemeEscalation', () => {
  test('themeId が null なら 0', async () => {
    expect(await recentThemeEscalation(null)).toBe(0);
  });

  test('サンプル不足(<3)なら 0', async () => {
    taskFindMany.mockResolvedValueOnce(tasks(2, 2)); // even all blocked, too few
    expect(await recentThemeEscalation(1)).toBe(0);
  });

  test('難航率 >= 0.5 → 2', async () => {
    taskFindMany.mockResolvedValueOnce(tasks(4, 2)); // 2/4 blocked
    expect(await recentThemeEscalation(1)).toBe(2);
  });

  test('難航率 0.25〜0.5 → 1（修復遷移で troubled 判定）', async () => {
    taskFindMany.mockResolvedValueOnce(tasks(4, 0)); // none blocked
    transitionFindMany.mockResolvedValueOnce([{ taskId: 1 }]); // 1/4 had a repair
    expect(await recentThemeEscalation(1)).toBe(1);
  });

  test('難航なし → 0', async () => {
    taskFindMany.mockResolvedValueOnce(tasks(5, 0));
    transitionFindMany.mockResolvedValueOnce([]);
    expect(await recentThemeEscalation(1)).toBe(0);
  });
});
