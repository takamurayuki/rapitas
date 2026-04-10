/**
 * CLI Tools Management Routes テスト
 * CLIツール管理APIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

// Mock logger
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

// Mock child_process via util.promisify
const mockExecAsync = mock(() => Promise.resolve({ stdout: '1.0.0\n', stderr: '' }));

mock.module('util', () => ({
  promisify: () => mockExecAsync,
}));

mock.module('fs/promises', () => ({
  default: {
    readFile: mock(() => Promise.resolve('')),
    writeFile: mock(() => Promise.resolve()),
    access: mock(() => Promise.resolve()),
    mkdir: mock(() => Promise.resolve()),
  },
}));

const { cliToolsManagementRoutes } = await import('../../../routes/agents/cli-tools/routes');

function createApp() {
  return new Elysia().use(cliToolsManagementRoutes);
}

describe('GET /cli-tools', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    mockExecAsync.mockClear();
    mockExecAsync.mockImplementation(() => Promise.resolve({ stdout: '1.0.0\n', stderr: '' }));
  });

  test('全CLIツールの一覧とステータスを返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/cli-tools'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.tools).toBeDefined();
    expect(Array.isArray(body.data.tools)).toBe(true);
    expect(body.data.tools.length).toBeGreaterThan(0);
    expect(body.data.summary).toBeDefined();
    expect(body.data.summary.total).toBe(body.data.tools.length);
  });

  test('各ツールに必要なフィールドが含まれていること', async () => {
    const res = await app.handle(new Request('http://localhost/cli-tools'));
    const body = await res.json();

    const tool = body.data.tools[0];
    expect(tool.id).toBeDefined();
    expect(tool.name).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(tool.category).toBeDefined();
    expect(tool.status).toBeDefined();
    expect(typeof tool.isInstalled).toBe('boolean');
  });

  test('コマンド実行失敗時もエラーにならずレスポンスを返すこと', async () => {
    mockExecAsync.mockImplementation(() => Promise.reject(new Error('Command not found')));

    const res = await app.handle(new Request('http://localhost/cli-tools'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.tools).toBeDefined();
  });
});

describe('GET /cli-tools/:toolId', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    mockExecAsync.mockClear();
    mockExecAsync.mockImplementation(() => Promise.resolve({ stdout: '1.0.0\n', stderr: '' }));
  });

  test('存在するツールIDで詳細情報を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/cli-tools/claude-cli'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.id).toBe('claude-cli');
    expect(body.data.name).toBe('Claude CLI');
  });

  test('存在しないツールIDでエラーを返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/cli-tools/nonexistent-tool'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Tool not found');
  });
});

describe('GET /cli-tools/:toolId/install-guide', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  test('存在するツールのインストールガイドを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/cli-tools/claude-cli/install-guide'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.tool).toBeDefined();
    expect(body.data.steps).toBeDefined();
    expect(Array.isArray(body.data.steps)).toBe(true);
    expect(body.data.steps.length).toBeGreaterThan(0);
  });

  test('インストールガイドにステップ番号とタイトルが含まれること', async () => {
    const res = await app.handle(new Request('http://localhost/cli-tools/gh-cli/install-guide'));
    const body = await res.json();

    const steps = body.data.steps;
    for (const step of steps) {
      expect(step.step).toBeDefined();
      expect(typeof step.step).toBe('number');
      expect(step.title).toBeDefined();
      expect(step.description).toBeDefined();
    }
  });

  test('存在しないツールIDでエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/cli-tools/nonexistent/install-guide'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Tool not found');
  });
});
