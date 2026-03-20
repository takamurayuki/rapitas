/**
 * Task Service テスト
 * task-service.ts のビジネスロジックのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Prisma mock
const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
    count: mock(() => Promise.resolve(0)),
  },
  taskLabel: {
    createMany: mock(() => Promise.resolve({ count: 0 })),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  studyStreak: {
    upsert: mock(() => Promise.resolve({})),
  },
  $transaction: mock((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
};

mock.module('../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../services/communication/notification-service', () => ({
  notifyTaskCompleted: mock(() => Promise.resolve()),
}));
mock.module('../../src/services/user-behavior-service', () => ({
  UserBehaviorService: {
    recordTaskCreated: mock(() => Promise.resolve()),
    recordTaskStarted: mock(() => Promise.resolve()),
    recordTaskCompleted: mock(() => Promise.resolve()),
    recordBehavior: mock(() => Promise.resolve()),
  },
}));
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: mock(() => Promise.resolve({ content: '{}', tokensUsed: 0 })),
  getDefaultProvider: mock(() => Promise.resolve('openai')),
  isAnyApiKeyConfigured: mock(() => Promise.resolve(false)),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const {
  createTask,
  updateTask,
  getFrequencyBasedSuggestions,
  cleanupDuplicateSubtasks,
  cleanupAllDuplicateSubtasks,
} = await import('../../services/task/task-service');

const { UserBehaviorService } = await import('../../src/services/user-behavior-service');

function resetAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    if (typeof model === 'object' && model !== null) {
      for (const method of Object.values(model)) {
        if (typeof method === 'function' && 'mockReset' in method) {
          (method as ReturnType<typeof mock>).mockReset();
        }
      }
    }
  }
  mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockPrisma),
  );
}

// ============ createTask ============

describe('createTask', () => {
  beforeEach(resetAllMocks);

  test('親タスクを作成すること', async () => {
    const createdTask = {
      id: 1,
      title: 'Test Task',
      status: 'todo',
      priority: 'medium',
      themeId: 1,
      parentId: null,
    };
    mockPrisma.task.create.mockResolvedValue(createdTask);
    mockPrisma.task.findUnique.mockResolvedValue(createdTask);

    const result = await createTask(mockPrisma as never, {
      title: 'Test Task',
      themeId: 1,
    });

    expect(result).toEqual(createdTask);
    expect(mockPrisma.task.create).toHaveBeenCalled();
  });

  test('ラベル付きで親タスクを作成すること', async () => {
    const createdTask = { id: 1, title: 'Test Task', parentId: null };
    mockPrisma.task.create.mockResolvedValue(createdTask);
    mockPrisma.task.findUnique.mockResolvedValue(createdTask);

    await createTask(mockPrisma as never, {
      title: 'Test Task',
      labelIds: [1, 2, 3],
    });

    expect(mockPrisma.taskLabel.createMany).toHaveBeenCalledWith({
      data: [
        { taskId: 1, labelId: 1 },
        { taskId: 1, labelId: 2 },
        { taskId: 1, labelId: 3 },
      ],
    });
  });

  test('親タスク作成時にユーザー行動を記録すること', async () => {
    const createdTask = { id: 1, title: 'Test Task', parentId: null };
    mockPrisma.task.create.mockResolvedValue(createdTask);
    mockPrisma.task.findUnique.mockResolvedValue(createdTask);

    await createTask(mockPrisma as never, { title: 'Test Task' });

    expect(UserBehaviorService.recordTaskCreated).toHaveBeenCalledWith(1, createdTask);
  });

  test('サブタスク作成時に親タスクの存在を確認すること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 10 });
    mockPrisma.task.findFirst.mockResolvedValue(null);
    mockPrisma.task.create.mockResolvedValue({ id: 2 });

    await createTask(mockPrisma as never, {
      title: 'Subtask',
      parentId: 10,
    });

    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  test('存在しない親タスクでエラーすること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    await expect(
      createTask(mockPrisma as never, { title: 'Subtask', parentId: 999 }),
    ).rejects.toThrow('見つかりません');
  });

  test('重複サブタスク作成を防止すること', async () => {
    const existingSubtask = { id: 5, title: 'Existing', parentId: 10 };
    // First call: parent check
    mockPrisma.task.findUnique
      .mockResolvedValueOnce({ id: 10 }) // parent exists
      .mockResolvedValueOnce(existingSubtask); // findUnique for existing subtask
    mockPrisma.task.findFirst.mockResolvedValue(existingSubtask);

    const result = await createTask(mockPrisma as never, {
      title: 'Existing',
      parentId: 10,
    });

    expect(result).toEqual(existingSubtask);
    expect(mockPrisma.task.create).not.toHaveBeenCalled();
  });
});

// ============ updateTask ============

describe('updateTask', () => {
  beforeEach(resetAllMocks);

  test('タスクを更新すること', async () => {
    const currentTask = { status: 'todo', parentId: null };
    const updatedTask = { id: 1, title: 'Updated', status: 'todo', themeId: 1, parentId: null };
    mockPrisma.task.findUnique
      .mockResolvedValueOnce(currentTask) // current state fetch
      .mockResolvedValueOnce(updatedTask); // updated state fetch

    const result = await updateTask(mockPrisma as never, 1, { title: 'Updated' });

    expect(result).toEqual(updatedTask);
    expect(mockPrisma.task.update).toHaveBeenCalled();
  });

  test('完了時にストリークを記録すること', async () => {
    const currentTask = { status: 'todo', parentId: null };
    const updatedTask = { id: 1, title: 'Task', status: 'done', themeId: 1, parentId: null };
    mockPrisma.task.findUnique
      .mockResolvedValueOnce(currentTask)
      .mockResolvedValueOnce(updatedTask);

    await updateTask(mockPrisma as never, 1, { status: 'done' });

    expect(mockPrisma.studyStreak.upsert).toHaveBeenCalled();
  });

  test('進行中への変更時にstartedAtを設定すること', async () => {
    const currentTask = { status: 'todo', parentId: null };
    const updatedTask = { id: 1, title: 'Task', status: 'in-progress', themeId: 1, parentId: null };
    mockPrisma.task.findUnique
      .mockResolvedValueOnce(currentTask)
      .mockResolvedValueOnce(updatedTask);

    await updateTask(mockPrisma as never, 1, { status: 'in-progress' });

    const updateCall = mockPrisma.task.update.mock.calls[0]![0] as {
      data: { startedAt?: Date };
    };
    expect(updateCall.data.startedAt).toBeInstanceOf(Date);
  });

  test('ラベルを更新すること', async () => {
    const currentTask = { status: 'todo', parentId: null };
    const updatedTask = { id: 1, title: 'Task', status: 'todo', themeId: 1, parentId: null };
    mockPrisma.task.findUnique
      .mockResolvedValueOnce(currentTask)
      .mockResolvedValueOnce(updatedTask);

    await updateTask(mockPrisma as never, 1, { labelIds: [2, 3] });

    expect(mockPrisma.taskLabel.deleteMany).toHaveBeenCalledWith({
      where: { taskId: 1 },
    });
    expect(mockPrisma.taskLabel.createMany).toHaveBeenCalledWith({
      data: [
        { taskId: 1, labelId: 2 },
        { taskId: 1, labelId: 3 },
      ],
    });
  });

  test('存在しないタスクの更新でエラーすること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    await expect(updateTask(mockPrisma as never, 999, { title: 'Updated' })).rejects.toThrow(
      '見つかりません',
    );
  });

  test('完了時に行動記録と通知をトリガーすること', async () => {
    const currentTask = { status: 'in-progress', parentId: null };
    const updatedTask = { id: 1, title: 'Task', status: 'done', themeId: 1, parentId: null };
    mockPrisma.task.findUnique
      .mockResolvedValueOnce(currentTask)
      .mockResolvedValueOnce(updatedTask);

    await updateTask(mockPrisma as never, 1, { status: 'done' });

    expect(UserBehaviorService.recordTaskCompleted).toHaveBeenCalledWith(1, updatedTask);
  });

  test('サブタスクの行動記録をスキップすること', async () => {
    // Reset the specific mock to ensure clean state
    (UserBehaviorService.recordTaskCompleted as ReturnType<typeof mock>).mockClear();

    const currentTask = { status: 'todo', parentId: 5 }; // has parent
    const updatedTask = { id: 2, title: 'Sub', status: 'done', themeId: 1, parentId: 5 };
    mockPrisma.task.findUnique
      .mockResolvedValueOnce(currentTask)
      .mockResolvedValueOnce(updatedTask);

    await updateTask(mockPrisma as never, 2, { status: 'done' });

    expect(UserBehaviorService.recordTaskCompleted).not.toHaveBeenCalled();
  });

  test('存在しないタスクでエラーをスローすること', async () => {
    // Simulate findUnique returning null
    mockPrisma.task.findUnique.mockResolvedValueOnce(null);

    // Verify updateTask throws an appropriate error
    await expect(updateTask(mockPrisma as never, 999, { title: 'Updated' })).rejects.toThrow(
      'タスク(ID: 999)が見つかりません',
    );

    // Verify update and other operations were not called
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(mockPrisma.studyStreak.upsert).not.toHaveBeenCalled();
  });
});

// ============ getFrequencyBasedSuggestions ============

describe('getFrequencyBasedSuggestions', () => {
  beforeEach(resetAllMocks);

  test('空の提案を返すこと（完了タスクなし）', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const result = await getFrequencyBasedSuggestions(mockPrisma as never, 1, 10);

    expect(result).toEqual([]);
  });

  test('頻度順にソートして返すこと', async () => {
    const completedTasks = [
      {
        id: 1,
        title: 'Daily Report',
        priority: 'medium',
        estimatedHours: 1,
        completedAt: new Date('2026-03-01'),
        description: null,
        taskLabels: [],
      },
      {
        id: 2,
        title: 'Daily Report',
        priority: 'medium',
        estimatedHours: 1,
        completedAt: new Date('2026-03-02'),
        description: null,
        taskLabels: [],
      },
      {
        id: 3,
        title: 'Weekly Review',
        priority: 'high',
        estimatedHours: 2,
        completedAt: new Date('2026-03-03'),
        description: null,
        taskLabels: [],
      },
    ];
    mockPrisma.task.findMany
      .mockResolvedValueOnce(completedTasks) // completed tasks
      .mockResolvedValueOnce([]); // existing active tasks

    const result = await getFrequencyBasedSuggestions(mockPrisma as never, 1, 10);

    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe('Daily Report');
    expect(result[0]!.frequency).toBe(2);
    expect(result[1]!.title).toBe('Weekly Review');
    expect(result[1]!.frequency).toBe(1);
  });

  test('既存タスクと重複する提案を除外すること', async () => {
    const completedTasks = [
      {
        id: 1,
        title: 'Task A',
        priority: 'medium',
        estimatedHours: 1,
        completedAt: new Date(),
        description: null,
        taskLabels: [],
      },
    ];
    const existingTasks = [{ title: 'Task A' }]; // same title active
    mockPrisma.task.findMany
      .mockResolvedValueOnce(completedTasks)
      .mockResolvedValueOnce(existingTasks);

    const result = await getFrequencyBasedSuggestions(mockPrisma as never, 1, 10);

    expect(result).toHaveLength(0);
  });

  test('件数制限を適用すること', async () => {
    const completedTasks = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      title: `Task ${i + 1}`,
      priority: 'medium',
      estimatedHours: 1,
      completedAt: new Date(),
      description: null,
      taskLabels: [],
    }));
    mockPrisma.task.findMany.mockResolvedValueOnce(completedTasks).mockResolvedValueOnce([]);

    const result = await getFrequencyBasedSuggestions(mockPrisma as never, 1, 5);

    expect(result).toHaveLength(5);
  });
});

// ============ cleanupDuplicateSubtasks ============

describe('cleanupDuplicateSubtasks', () => {
  beforeEach(resetAllMocks);

  test('重複サブタスクを削除して最初の1つを残すこと', async () => {
    const subtasks = [
      { id: 1, title: 'Subtask A', createdAt: new Date('2026-01-01') },
      { id: 2, title: 'Subtask A', createdAt: new Date('2026-01-02') },
      { id: 3, title: 'subtask a', createdAt: new Date('2026-01-03') }, // case-insensitive dup
      { id: 4, title: 'Subtask B', createdAt: new Date('2026-01-01') },
    ];
    mockPrisma.task.findMany.mockResolvedValue(subtasks);

    const deletedIds = await cleanupDuplicateSubtasks(mockPrisma as never, 10);

    expect(deletedIds).toEqual([2, 3]); // kept id:1, deleted id:2 and id:3
    expect(mockPrisma.task.delete).toHaveBeenCalledTimes(2);
  });

  test('重複がない場合は空配列を返すこと', async () => {
    const subtasks = [
      { id: 1, title: 'Subtask A', createdAt: new Date() },
      { id: 2, title: 'Subtask B', createdAt: new Date() },
    ];
    mockPrisma.task.findMany.mockResolvedValue(subtasks);

    const deletedIds = await cleanupDuplicateSubtasks(mockPrisma as never, 10);

    expect(deletedIds).toEqual([]);
    expect(mockPrisma.task.delete).not.toHaveBeenCalled();
  });
});

// ============ cleanupAllDuplicateSubtasks ============

describe('cleanupAllDuplicateSubtasks', () => {
  beforeEach(resetAllMocks);

  test('複数の親タスクから重複を削除すること', async () => {
    const allSubtasks = [
      { id: 1, title: 'Sub A', parentId: 10, createdAt: new Date('2026-01-01') },
      { id: 2, title: 'Sub A', parentId: 10, createdAt: new Date('2026-01-02') },
      { id: 3, title: 'Sub B', parentId: 20, createdAt: new Date('2026-01-01') },
      { id: 4, title: 'Sub B', parentId: 20, createdAt: new Date('2026-01-02') },
    ];
    mockPrisma.task.findMany.mockResolvedValue(allSubtasks);

    const result = await cleanupAllDuplicateSubtasks(mockPrisma as never);

    expect(result.deletedIds).toEqual([2, 4]);
    expect(result.affectedParents).toEqual([10, 20]);
  });

  test('重複がない場合は空を返すこと', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const result = await cleanupAllDuplicateSubtasks(mockPrisma as never);

    expect(result.deletedIds).toEqual([]);
    expect(result.affectedParents).toEqual([]);
  });
});
