/**
 * Projects Routes テスト
 * プロジェクトCRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  project: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
  task: {
    findMany: mock(() => Promise.resolve([])),
  },
  milestone: {
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module('../../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { projectsRoutes } = await import('../../../routes/organization/projects');
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

function createApp() {
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
    .use(projectsRoutes);
}

describe('GET /projects', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全プロジェクトを返すこと', async () => {
    const projects = [
      {
        id: 1,
        name: 'Project A',
        _count: { tasks: 5, milestones: 2 },
      },
      {
        id: 2,
        name: 'Project B',
        _count: { tasks: 3, milestones: 1 },
      },
    ];
    mockPrisma.project.findMany.mockResolvedValue(projects);

    const res = await app.handle(new Request('http://localhost/projects'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].name).toBe('Project A');
  });

  test('空配列を返すこと', async () => {
    mockPrisma.project.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/projects'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe('GET /projects/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('IDでプロジェクトを取得すること', async () => {
    const project = {
      id: 1,
      name: 'Project A',
      milestones: [],
      tasks: [],
    };
    mockPrisma.project.findUnique.mockResolvedValue(project);

    const res = await app.handle(new Request('http://localhost/projects/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.name).toBe('Project A');
  });

  test('存在しないIDでnullを返すこと', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/projects/999'));

    // Elysia returns 200 with null body (no content)
    expect(res.status).toBe(200);
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/projects/abc'));

    expect(res.status).toBe(400);
  });
});

describe('POST /projects', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('プロジェクトを作成すること', async () => {
    const created = {
      id: 3,
      name: 'New Project',
      color: '#3B82F6',
    };
    mockPrisma.project.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Project', color: '#3B82F6' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('New Project');
    expect(mockPrisma.project.create).toHaveBeenCalledTimes(1);
  });

  test('名前なしでバリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('PATCH /projects/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('プロジェクトを更新すること', async () => {
    const updated = { id: 1, name: 'Updated Project' };
    mockPrisma.project.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/projects/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Project' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Updated Project');
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/projects/abc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe('DELETE /projects/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('プロジェクトを削除すること', async () => {
    const project = { id: 1, name: 'Delete Me' };
    mockPrisma.project.delete.mockResolvedValue(project);

    const res = await app.handle(new Request('http://localhost/projects/1', { method: 'DELETE' }));

    expect(res.status).toBe(200);
    expect(mockPrisma.project.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/projects/abc', { method: 'DELETE' }),
    );

    expect(res.status).toBe(400);
  });
});
