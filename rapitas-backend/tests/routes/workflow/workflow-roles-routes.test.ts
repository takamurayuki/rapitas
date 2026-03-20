/**
 * Workflow Roles Routes テスト
 * ワークフローロール設定のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  workflowRoleConfig: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    createMany: mock(() => Promise.resolve({ count: 0 })),
    update: mock(() => Promise.resolve({})),
  },
  aIAgentConfig: {
    findUnique: mock(() => Promise.resolve(null)),
  },
  systemPrompt: {
    findUnique: mock(() => Promise.resolve(null)),
  },
};

mock.module('../../../config', () => ({
  prisma: mockPrisma,
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('../../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { workflowRolesRoutes } = await import('../../../routes/workflow/core/workflow-roles');

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
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return {
        error: error instanceof Error ? error.message : 'Server error',
      };
    })
    .use(workflowRolesRoutes);
}

describe('GET /workflow-roles', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全ロール設定を返すこと', async () => {
    const roles = [
      { id: 1, role: 'researcher', isEnabled: true, agentConfig: null },
      { id: 2, role: 'planner', isEnabled: true, agentConfig: null },
      { id: 3, role: 'reviewer', isEnabled: true, agentConfig: null },
      { id: 4, role: 'implementer', isEnabled: true, agentConfig: null },
      { id: 5, role: 'verifier', isEnabled: true, agentConfig: null },
      { id: 6, role: 'auto_verifier', isEnabled: true, agentConfig: null },
    ];
    // ensureRolesExist will call findMany first, then the main query calls findMany again
    mockPrisma.workflowRoleConfig.findMany
      .mockResolvedValueOnce(roles.map((r) => ({ role: r.role })))
      .mockResolvedValueOnce(roles);

    const res = await app.handle(new Request('http://localhost/workflow-roles'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(6);
  });

  test('欠落ロールの自動初期化が行われること', async () => {
    // findMany returns empty (no existing roles)
    mockPrisma.workflowRoleConfig.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const res = await app.handle(new Request('http://localhost/workflow-roles'));

    expect(res.status).toBe(200);
    expect(mockPrisma.workflowRoleConfig.createMany).toHaveBeenCalledTimes(1);
  });
});

describe('GET /workflow-roles/:role', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('特定ロールの設定を取得すること', async () => {
    const config = {
      id: 1,
      role: 'researcher',
      isEnabled: true,
      systemPromptKey: 'workflow_role_researcher',
      agentConfig: null,
    };
    mockPrisma.workflowRoleConfig.findMany.mockResolvedValue([{ role: 'researcher' }]);
    mockPrisma.workflowRoleConfig.findUnique.mockResolvedValue(config);

    const res = await app.handle(new Request('http://localhost/workflow-roles/researcher'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.role).toBe('researcher');
    expect(body.isEnabled).toBe(true);
  });

  test('無効なロール名で400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/workflow-roles/invalid_role'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('無効なロール');
  });

  test('存在しないロール設定で404を返すこと', async () => {
    mockPrisma.workflowRoleConfig.findMany.mockResolvedValue([{ role: 'researcher' }]);
    mockPrisma.workflowRoleConfig.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/workflow-roles/researcher'));

    expect(res.status).toBe(404);
  });
});

describe('PUT /workflow-roles/:role', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ロール設定を更新すること', async () => {
    const updated = {
      id: 1,
      role: 'researcher',
      isEnabled: false,
      agentConfig: null,
    };
    mockPrisma.workflowRoleConfig.findMany.mockResolvedValue([{ role: 'researcher' }]);
    mockPrisma.workflowRoleConfig.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/workflow-roles/researcher', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: false }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isEnabled).toBe(false);
  });

  test('無効なロール名で400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/workflow-roles/invalid', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: true }),
      }),
    );

    expect(res.status).toBe(400);
  });

  test('存在しないエージェントIDで400を返すこと', async () => {
    mockPrisma.workflowRoleConfig.findMany.mockResolvedValue([{ role: 'researcher' }]);
    mockPrisma.aIAgentConfig.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/workflow-roles/researcher', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentConfigId: 999 }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe('POST /workflow-roles/initialize', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ロール初期化を実行すること', async () => {
    const roles = [{ id: 1, role: 'researcher', isEnabled: true, agentConfig: null }];
    mockPrisma.workflowRoleConfig.findMany
      .mockResolvedValueOnce([{ role: 'researcher' }])
      .mockResolvedValueOnce(roles);

    const res = await app.handle(
      new Request('http://localhost/workflow-roles/initialize', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe('ロール初期化完了');
    expect(body.roles).toBeDefined();
  });
});
