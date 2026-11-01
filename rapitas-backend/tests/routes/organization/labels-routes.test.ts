/**
 * Labels Routes テスト
 * ラベルCRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  label: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
  taskLabel: {
    createMany: mock(() => Promise.resolve({ count: 0 })),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  task: {
    findUnique: mock(() => Promise.resolve(null)),
  },
  // NOTE(#1349): replaceTaskLabels opens a transaction. Without this the bulk
  // route threw `$transaction is not a function` and answered 500, so the PUT
  // tests below went red for the wrong reason — they never reached the delete
  // that a truncated id aims at the wrong task.
  $transaction: mock((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
};

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { labelsRoutes, taskLabelsRoutes } = await import('../../../routes/organization/labels');
const { AppError } = await import('../../../middleware/error-handler');

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
}

// NOTE(#1349): takes the router so the bulk-replacement route can be mounted
// too. taskLabelsRoutes is a SEPARATE Elysia instance with no /labels prefix —
// mounting labelsRoutes and asking for /labels/tasks/5e2/labels reaches no
// handler at all, which is how the first version of the PUT tests below
// "failed" for the wrong reason.
function createApp(routes: Parameters<Elysia['use']>[0] = labelsRoutes) {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (error instanceof AppError) {
        set.status = error.statusCode;
        return { error: error.message, code: error.code };
      }
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return {
        error: error instanceof Error ? error.message : 'Server error',
      };
    })
    .use(routes);
}

describe('GET /labels', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全ラベルを返すこと', async () => {
    const labels = [
      { id: 1, name: 'Bug', color: '#FF0000', _count: { tasks: 3 } },
      { id: 2, name: 'Feature', color: '#00FF00', _count: { tasks: 5 } },
    ];
    mockPrisma.label.findMany.mockResolvedValue(labels);

    const res = await app.handle(new Request('http://localhost/labels'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].name).toBe('Bug');
  });

  test('空配列を返すこと', async () => {
    mockPrisma.label.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/labels'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe('GET /labels/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('IDでラベルを取得すること', async () => {
    const label = {
      id: 1,
      name: 'Bug',
      color: '#FF0000',
      tasks: [],
    };
    mockPrisma.label.findUnique.mockResolvedValue(label);

    const res = await app.handle(new Request('http://localhost/labels/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.name).toBe('Bug');
  });

  test('存在しないIDで404を返すこと', async () => {
    mockPrisma.label.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/labels/999'));

    expect(res.status).toBe(404);
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/labels/abc'));

    expect(res.status).toBe(400);
  });

  // NOTE(#1349): GET も同じ切り捨てをしていた。'5e2' は 5、'0x10' は 16 で
  // isNaN は false なので、呼び出し元が指していないラベルを返していた。
  test.each([
    ['指数表記', '5e2'],
    ['数値に続く接尾辞', '5abc'],
    ['16進表記', '0x10'],
    ['ゼロ', '0'],
  ])('無効なID(%s: %s)でDBに触れず400を返すこと', async (_label, raw) => {
    const res = await app.handle(new Request(`http://localhost/labels/${raw}`));

    expect(res.status).toBe(400);
    expect(mockPrisma.label.findUnique).not.toHaveBeenCalled();
  });
});

describe('POST /labels', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ラベルを作成すること', async () => {
    const created = { id: 3, name: 'Urgent', color: '#FFA500' };
    mockPrisma.label.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Urgent', color: '#FFA500' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Urgent');
    expect(mockPrisma.label.create).toHaveBeenCalledTimes(1);
  });

  test('名前なしでバリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('PATCH /labels/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ラベルを更新すること', async () => {
    const updated = { id: 1, name: 'Critical', color: '#FF0000' };
    mockPrisma.label.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/labels/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Critical' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Critical');
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/labels/abc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      }),
    );

    expect(res.status).toBe(400);
  });

  // NOTE(#1349): 'abc' 以外は素通りしていた。isNaN は parseInt の結果を見るので
  // '5e2' → 5 も '5abc' → 5 も false になり、呼び出し元が指していないラベルを
  // 更新していた。update が呼ばれないことまで見る。
  test.each([
    ['指数表記', '5e2'],
    ['数値に続く接尾辞', '5abc'],
    ['小数', '5.9'],
    ['ゼロ', '0'],
  ])('無効なID(%s: %s)でDBに触れず400を返すこと', async (_label, raw) => {
    const res = await app.handle(
      new Request(`http://localhost/labels/${raw}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mockPrisma.label.update).not.toHaveBeenCalled();
  });
});

// PUT /tasks/:id/labels — a task's labels are REPLACED wholesale, so a
// truncated id wipes another task's labels. #1330 made the replacement atomic;
// #1349 is about it running against the right row. There was no test here.
describe('PUT /tasks/:id/labels', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp(taskLabelsRoutes);
  });

  const put = (raw: string) =>
    app.handle(
      new Request(`http://localhost/tasks/${raw}/labels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labelIds: [1] }),
      }),
    );

  test.each([
    ['指数表記', '5e2'],
    ['数値に続く接尾辞', '5abc'],
    ['小数', '5.9'],
    ['ゼロ', '0'],
  ])('無効なタスクID(%s: %s)で他タスクのラベルを消さないこと', async (_label, raw) => {
    // The label the body names EXISTS, so nothing downstream refuses the
    // request on its own: left at the default [], replaceTaskLabels threw on a
    // missing label id and the test would pass without the truncation ever
    // reaching the delete.
    mockPrisma.label.findMany.mockResolvedValue([{ id: 1 }]);

    const res = await put(raw);

    expect(res.status).toBe(400);
    // What actually matters: the delete is aimed at a taskId the caller never
    // typed. Before this fix '5e2' reached task 5 and emptied its labels.
    expect(mockPrisma.taskLabel.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.taskLabel.createMany).not.toHaveBeenCalled();
  });
});

describe('DELETE /labels/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ラベルを削除すること', async () => {
    const label = { id: 1, name: 'Bug' };
    mockPrisma.label.delete.mockResolvedValue(label);

    const res = await app.handle(new Request('http://localhost/labels/1', { method: 'DELETE' }));

    expect(res.status).toBe(200);
    expect(mockPrisma.label.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/labels/abc', { method: 'DELETE' }));

    expect(res.status).toBe(400);
  });

  // NOTE(#1349): 'abc' だけを見ていたので、他の無効な id は素通りしていた。
  // parseInt は読めない文字で止まるため '5e2' は 500、'5abc' は 5 になり、
  // isNaN が true にならない。呼び出し元が指していないラベルを削除していた。
  // ステータスだけでなく delete が呼ばれないことを見る。
  test.each([
    ['指数表記', '5e2'],
    ['数値に続く接尾辞', '5abc'],
    ['小数', '5.9'],
    ['ゼロ', '0'],
    ['負の数', '-3'],
  ])('無効なID(%s: %s)でDBに触れず400を返すこと', async (_label, raw) => {
    const res = await app.handle(
      new Request(`http://localhost/labels/${raw}`, { method: 'DELETE' }),
    );

    expect(res.status).toBe(400);
    expect(mockPrisma.label.delete).not.toHaveBeenCalled();
  });
});
