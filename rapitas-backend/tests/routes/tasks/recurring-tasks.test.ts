/**
 * Recurring Task Routes テスト
 * 繰り返しタスクの設定/解除/プレビュー/生成済みタスク取得のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  task: {
    findUnique: mock(() => Promise.resolve(null)),
  },
};

const mockSetTaskRecurrence = mock(() => Promise.resolve({ id: 1 }));
const mockRemoveTaskRecurrence = mock(() => Promise.resolve({ id: 1 }));
const mockGetUpcomingOccurrences = mock(() => [] as Date[]);
const mockGetGeneratedTasks = mock(() => Promise.resolve([] as unknown[]));

mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
  logger: {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    child: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
  },
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../../services/scheduling', () => ({
  setTaskRecurrence: mockSetTaskRecurrence,
  removeTaskRecurrence: mockRemoveTaskRecurrence,
  getUpcomingOccurrences: mockGetUpcomingOccurrences,
  getGeneratedTasks: mockGetGeneratedTasks,
  RECURRENCE_PRESETS: {
    daily: 'FREQ=DAILY;INTERVAL=1',
    weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    weekly: 'FREQ=WEEKLY;INTERVAL=1',
    biweekly: 'FREQ=WEEKLY;INTERVAL=2',
    monthly: 'FREQ=MONTHLY;INTERVAL=1',
    yearly: 'FREQ=YEARLY;INTERVAL=1',
  },
}));

const { recurringTaskRoutes } = await import('../../../routes/tasks/recurring-tasks');

function resetAllMocks() {
  mockPrisma.task.findUnique.mockReset();
  mockPrisma.task.findUnique.mockResolvedValue(null);
  mockSetTaskRecurrence.mockReset();
  mockSetTaskRecurrence.mockResolvedValue({ id: 1 });
  mockRemoveTaskRecurrence.mockReset();
  mockRemoveTaskRecurrence.mockResolvedValue({ id: 1 });
  mockGetUpcomingOccurrences.mockReset();
  mockGetUpcomingOccurrences.mockReturnValue([]);
  mockGetGeneratedTasks.mockReset();
  mockGetGeneratedTasks.mockResolvedValue([]);
}

function createApp() {
  return new Elysia()
    .onError(({ code, set }) => {
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return { error: 'Server error' };
    })
    .use(recurringTaskRoutes);
}

describe('PUT /tasks/:id/recurrence', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('繰り返し設定を保存すること', async () => {
    const task = { id: 5, isRecurring: true, recurrenceRule: 'FREQ=DAILY;INTERVAL=1' };
    mockSetTaskRecurrence.mockResolvedValue(task);

    const res = await app.handle(
      new Request('http://localhost/tasks/5/recurrence', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurrenceRule: 'FREQ=DAILY;INTERVAL=1' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.task).toEqual(task);
    expect(body.message).toBe('繰り返し設定を保存しました');

    const call = mockSetTaskRecurrence.mock.calls[0]!;
    expect(call[1]).toBe(5);
    expect(call[2]).toEqual({
      recurrenceRule: 'FREQ=DAILY;INTERVAL=1',
      recurrenceEndAt: null,
      recurrenceTime: '00:00',
      inheritWorkflowFiles: true,
    });
  });

  test('recurrenceEndAt/recurrenceTime/inheritWorkflowFilesを明示指定できること', async () => {
    mockSetTaskRecurrence.mockResolvedValue({ id: 5 });

    await app.handle(
      new Request('http://localhost/tasks/5/recurrence', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
          recurrenceEndAt: '2026-12-31T00:00:00.000Z',
          recurrenceTime: '09:00',
          inheritWorkflowFiles: false,
        }),
      }),
    );

    const call = mockSetTaskRecurrence.mock.calls[0]!;
    const input = call[2] as { recurrenceEndAt: Date | null; recurrenceTime: string };
    expect(input.recurrenceEndAt).toEqual(new Date('2026-12-31T00:00:00.000Z'));
    expect(input.recurrenceTime).toBe('09:00');
  });

  test('サービスがエラーを投げた場合400を返すこと', async () => {
    mockSetTaskRecurrence.mockImplementation(() => Promise.reject(new Error('Task not found: 5')));

    const res = await app.handle(
      new Request('http://localhost/tasks/5/recurrence', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurrenceRule: 'FREQ=DAILY;INTERVAL=1' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Task not found: 5');
  });

  test('recurrenceRuleが空文字の場合バリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/tasks/5/recurrence', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurrenceRule: '' }),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('DELETE /tasks/:id/recurrence', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('繰り返し設定を解除すること', async () => {
    const task = { id: 5, isRecurring: false };
    mockRemoveTaskRecurrence.mockResolvedValue(task);

    const res = await app.handle(
      new Request('http://localhost/tasks/5/recurrence', { method: 'DELETE' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.task).toEqual(task);
    expect(body.message).toBe('繰り返し設定を解除しました');
    expect(mockRemoveTaskRecurrence.mock.calls[0]![1]).toBe(5);
  });

  test('サービスがエラーを投げた場合400を返すこと', async () => {
    mockRemoveTaskRecurrence.mockImplementation(() => Promise.reject(new Error('boom')));

    const res = await app.handle(
      new Request('http://localhost/tasks/5/recurrence', { method: 'DELETE' }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe('boom');
  });
});

describe('GET /tasks/:id/occurrences', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('タスクが存在しない場合エラーメッセージを返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/tasks/5/occurrences'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Task not found');
    expect(mockGetUpcomingOccurrences).not.toHaveBeenCalled();
  });

  test('繰り返し設定のないタスクは空配列を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: 5,
      isRecurring: false,
      recurrenceRule: null,
    });

    const res = await app.handle(new Request('http://localhost/tasks/5/occurrences'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.occurrences).toEqual([]);
    expect(body.message).toBe('このタスクには繰り返し設定がありません');
    expect(mockGetUpcomingOccurrences).not.toHaveBeenCalled();
  });

  test('繰り返し設定のあるタスクの今後の日程を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: 5,
      isRecurring: true,
      recurrenceRule: 'FREQ=DAILY;INTERVAL=1',
      recurrenceEndAt: new Date('2026-12-31T00:00:00.000Z'),
    });
    const occurrences = [
      new Date('2026-07-04T00:00:00.000Z'),
      new Date('2026-07-05T00:00:00.000Z'),
    ];
    mockGetUpcomingOccurrences.mockReturnValue(occurrences);

    const res = await app.handle(new Request('http://localhost/tasks/5/occurrences?limit=2'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.occurrences).toEqual(occurrences.map((d) => d.toISOString()));
    expect(body.recurrenceRule).toBe('FREQ=DAILY;INTERVAL=1');
    expect(body.recurrenceEndAt).toBe('2026-12-31T00:00:00.000Z');

    const call = mockGetUpcomingOccurrences.mock.calls[0]!;
    expect(call[0]).toBe('FREQ=DAILY;INTERVAL=1');
    expect(call[3]).toBe(2);
  });

  test('limit未指定時はデフォルト10件で問い合わせること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({
      id: 5,
      isRecurring: true,
      recurrenceRule: 'FREQ=DAILY;INTERVAL=1',
      recurrenceEndAt: null,
    });

    const res = await app.handle(new Request('http://localhost/tasks/5/occurrences'));
    const body = await res.json();

    expect(body.recurrenceEndAt).toBeNull();
    const call = mockGetUpcomingOccurrences.mock.calls[0]!;
    expect(call[3]).toBe(10);
  });
});

describe('GET /tasks/:id/generated', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('生成済みタスクを返すこと', async () => {
    const tasks = [{ id: 1 }, { id: 2 }];
    mockGetGeneratedTasks.mockResolvedValue(tasks);

    const res = await app.handle(new Request('http://localhost/tasks/5/generated'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.tasks).toEqual(tasks);
    expect(body.count).toBe(2);

    const call = mockGetGeneratedTasks.mock.calls[0]!;
    expect(call[1]).toBe(5);
    expect(call[2]).toEqual({ limit: 50, includeCompleted: true });
  });

  test('limitとincludeCompleted=falseを反映すること', async () => {
    mockGetGeneratedTasks.mockResolvedValue([]);

    await app.handle(
      new Request('http://localhost/tasks/5/generated?limit=5&includeCompleted=false'),
    );

    const call = mockGetGeneratedTasks.mock.calls[0]!;
    expect(call[2]).toEqual({ limit: 5, includeCompleted: false });
  });
});

describe('POST /tasks/recurrence/preview', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('プレビューの日程を返すこと', async () => {
    const occurrences = [new Date('2026-07-04T00:00:00.000Z')];
    mockGetUpcomingOccurrences.mockReturnValue(occurrences);

    const res = await app.handle(
      new Request('http://localhost/tasks/recurrence/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurrenceRule: 'FREQ=DAILY;INTERVAL=1' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.occurrences).toEqual(occurrences.map((d) => d.toISOString()));
  });

  test('不正なルールでエラーを返すこと', async () => {
    mockGetUpcomingOccurrences.mockImplementation(() => {
      throw new Error('invalid rule');
    });

    const res = await app.handle(
      new Request('http://localhost/tasks/recurrence/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurrenceRule: 'GARBAGE' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toBe('invalid rule');
  });

  test('limitとrecurrenceEndAtの指定を伝播すること', async () => {
    mockGetUpcomingOccurrences.mockReturnValue([]);

    await app.handle(
      new Request('http://localhost/tasks/recurrence/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recurrenceRule: 'FREQ=DAILY;INTERVAL=1',
          recurrenceEndAt: '2026-12-31T00:00:00.000Z',
          limit: 3,
        }),
      }),
    );

    const call = mockGetUpcomingOccurrences.mock.calls[0]!;
    expect(call[2]).toEqual(new Date('2026-12-31T00:00:00.000Z'));
    expect(call[3]).toBe(3);
  });

  test('recurrenceRuleが空文字の場合バリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/tasks/recurrence/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurrenceRule: '' }),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('GET /tasks/recurrence/presets', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('既知キーは日本語ラベル付きで返し、未知キーはキー自身をラベルにフォールバックすること', async () => {
    const res = await app.handle(new Request('http://localhost/tasks/recurrence/presets'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const daily = body.presets.find((p: { key: string }) => p.key === 'daily');
    expect(daily).toEqual({ key: 'daily', rule: 'FREQ=DAILY;INTERVAL=1', label: '毎日' });
    expect(body.presets).toHaveLength(6);
  });
});
