/**
 * Pomodoro Stats テスト
 * ポモドーロ統計関連のサービス関数テスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  pomodoroSession: {
    findMany: mock(() => Promise.resolve([])),
    count: mock(() => Promise.resolve(0)),
    aggregate: mock(() => Promise.resolve({ _sum: { duration: 0 }, _avg: { duration: 0 } })),
  },
};

mock.module('../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { getStatistics } = await import('../../services/pomodoro-service');

describe('getStatistics - 集計テスト', () => {
  beforeEach(() => {
    mockPrisma.pomodoroSession.findMany.mockReset();
    mockPrisma.pomodoroSession.count.mockReset();
    mockPrisma.pomodoroSession.findMany.mockResolvedValue([]);
  });

  test('セッションがゼロ件の場合すべてゼロを返すこと', async () => {
    mockPrisma.pomodoroSession.findMany.mockResolvedValue([]);

    const result = await getStatistics({});
    expect(result.totalPomodoros).toBe(0);
    expect(result.totalMinutes).toBe(0);
    expect(result.averagePerDay).toBe(0);
    expect(result.dailyStats).toEqual([]);
  });

  test('複数日にまたがるセッションの日別集計が正しいこと', async () => {
    mockPrisma.pomodoroSession.findMany.mockResolvedValue([
      {
        id: 1,
        duration: 1500,
        completedAt: new Date('2026-03-01'),
        createdAt: new Date('2026-03-01'),
        taskId: null,
        task: null,
      },
      {
        id: 2,
        duration: 1500,
        completedAt: new Date('2026-03-01'),
        createdAt: new Date('2026-03-01'),
        taskId: null,
        task: null,
      },
      {
        id: 3,
        duration: 1500,
        completedAt: new Date('2026-03-02'),
        createdAt: new Date('2026-03-02'),
        taskId: null,
        task: null,
      },
    ]);

    const result = await getStatistics({});
    expect(result.totalPomodoros).toBe(3);
    expect(result.dailyStats.length).toBe(2);
  });

  test('タスク別の集計がcount降順にソートされること', async () => {
    mockPrisma.pomodoroSession.findMany.mockResolvedValue([
      {
        id: 1,
        duration: 1500,
        completedAt: new Date('2026-03-05'),
        createdAt: new Date('2026-03-05'),
        taskId: 1,
        task: { id: 1, title: '少ないタスク' },
      },
      {
        id: 2,
        duration: 1500,
        completedAt: new Date('2026-03-05'),
        createdAt: new Date('2026-03-05'),
        taskId: 2,
        task: { id: 2, title: '多いタスク' },
      },
      {
        id: 3,
        duration: 1500,
        completedAt: new Date('2026-03-05'),
        createdAt: new Date('2026-03-05'),
        taskId: 2,
        task: { id: 2, title: '多いタスク' },
      },
      {
        id: 4,
        duration: 1500,
        completedAt: new Date('2026-03-05'),
        createdAt: new Date('2026-03-05'),
        taskId: 2,
        task: { id: 2, title: '多いタスク' },
      },
    ]);

    const result = await getStatistics({});
    expect(result.taskStats.length).toBe(2);
    expect(result.taskStats[0]!.title).toBe('多いタスク');
    expect(result.taskStats[0]!.count).toBe(3);
    expect(result.taskStats[1]!.title).toBe('少ないタスク');
    expect(result.taskStats[1]!.count).toBe(1);
  });

  test('totalMinutesが正しく秒から分に変換されること', async () => {
    mockPrisma.pomodoroSession.findMany.mockResolvedValue([
      {
        id: 1,
        duration: 1500,
        completedAt: new Date('2026-03-05'),
        createdAt: new Date('2026-03-05'),
        taskId: null,
        task: null,
      },
      {
        id: 2,
        duration: 3000,
        completedAt: new Date('2026-03-05'),
        createdAt: new Date('2026-03-05'),
        taskId: null,
        task: null,
      },
    ]);

    const result = await getStatistics({});
    expect(result.totalMinutes).toBe(75); // (1500 + 3000) / 60
  });
});
