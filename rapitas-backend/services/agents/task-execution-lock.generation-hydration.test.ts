/**
 * task-execution-lock generation-hydration テスト
 *
 * getTaskExecutionCancellationVersion の読み取り時DBハイドレーション（task 881）:
 * DB値と同一プロセス内カウンタのmax-merge、taskIdごと1回のみのfetch、失敗時の再試行を検証する。
 */
import { describe, test, expect, mock } from 'bun:test';

const mockFindUnique = mock(() =>
  Promise.resolve(null as { executionGenerationId: number } | null),
);
const mockTaskUpdate = mock(() => Promise.resolve({ executionGenerationId: 0 }));

mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findUnique: mockFindUnique,
      update: mockTaskUpdate,
    },
  },
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { getTaskExecutionCancellationVersion, incrementTaskGenerationId } =
  await import('./task-execution-lock');

/** Wait one microtask turn so a fire-and-forget promise chain settles. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('getTaskExecutionCancellationVersion — DB hydration', () => {
  test('DB値が現在のメモリ値より大きい場合、後続呼び出しでDB値に更新される', async () => {
    const taskId = 50001;
    mockFindUnique.mockResolvedValueOnce({ executionGenerationId: 7 });

    expect(getTaskExecutionCancellationVersion(taskId)).toBe(0);
    await flush();
    expect(getTaskExecutionCancellationVersion(taskId)).toBe(7);
  });

  test('同一プロセス内でincrementした値がDB読み取りより新しい場合、後退しない', async () => {
    const taskId = 50002;
    mockFindUnique.mockResolvedValueOnce({ executionGenerationId: 1 });
    mockTaskUpdate.mockResolvedValueOnce({ executionGenerationId: 5 });

    await incrementTaskGenerationId(taskId);
    expect(getTaskExecutionCancellationVersion(taskId)).toBe(5);
    await flush();
    // stale DB read (1) must not regress the already-advanced in-memory value (5)
    expect(getTaskExecutionCancellationVersion(taskId)).toBe(5);
  });

  test('同一taskIdのDB読み取りはプロセス内で1回のみ発火する', async () => {
    const taskId = 50003;
    mockFindUnique.mockClear();
    mockFindUnique.mockResolvedValue({ executionGenerationId: 3 });

    getTaskExecutionCancellationVersion(taskId);
    getTaskExecutionCancellationVersion(taskId);
    getTaskExecutionCancellationVersion(taskId);
    await flush();

    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  test('DB読み取り失敗時は次回呼び出しで再試行される', async () => {
    const taskId = 50004;
    mockFindUnique.mockClear();
    mockFindUnique.mockRejectedValueOnce(new Error('db unreachable'));
    mockFindUnique.mockResolvedValueOnce({ executionGenerationId: 9 });

    getTaskExecutionCancellationVersion(taskId);
    await flush();
    expect(getTaskExecutionCancellationVersion(taskId)).toBe(0);

    await flush();
    expect(getTaskExecutionCancellationVersion(taskId)).toBe(9);
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });
});
