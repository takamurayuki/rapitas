/**
 * Execution Logs Routes テスト
 * 実行ログファイルAPIのユニットテスト
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

// Mock execution-file-logger
const mockListExecutionLogFiles = mock(() =>
  Promise.resolve([
    {
      filename: 'exec-123-2024-01-01.log',
      size: 1024,
      mtime: new Date('2024-01-01'),
      path: '/logs/exec-123-2024-01-01.log',
    },
    {
      filename: 'exec-456-2024-01-02.log',
      size: 2048,
      mtime: new Date('2024-01-02'),
      path: '/logs/exec-456-2024-01-02.log',
    },
  ]),
);

const mockGetExecutionLogFile = mock(() => Promise.resolve(null));

mock.module('../../../services/agents/execution-file-logger', () => ({
  listExecutionLogFiles: mockListExecutionLogFiles,
  getExecutionLogFile: mockGetExecutionLogFile,
}));

// Mock fs/promises readFile
mock.module('fs/promises', () => ({
  readFile: mock(() => Promise.resolve('log content here')),
}));

const { executionLogsRoutes } = await import('../../../routes/agents/monitoring/execution-logs');

function createApp() {
  return new Elysia().use(executionLogsRoutes);
}

describe('GET /api/execution-logs', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    mockListExecutionLogFiles.mockClear();
    mockGetExecutionLogFile.mockClear();
  });

  test('ログファイル一覧を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/api/execution-logs'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.offset).toBe(0);
    expect(body.limit).toBe(50);
    expect(body.files).toHaveLength(2);
    expect(body.files[0].filename).toBe('exec-123-2024-01-01.log');
    expect(body.files[0].size).toBe(1024);
    expect(body.files[0].sizeHuman).toBe('1.0 KB');
    expect(body.files[0].executionId).toBe(123);
    expect(body.files[1].filename).toBe('exec-456-2024-01-02.log');
    expect(body.files[1].executionId).toBe(456);
  });

  test('limitパラメータで件数を制限できること', async () => {
    const res = await app.handle(new Request('http://localhost/api/execution-logs?limit=1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.limit).toBe(1);
    expect(body.files).toHaveLength(1);
  });

  test('offsetパラメータでオフセット指定できること', async () => {
    const res = await app.handle(new Request('http://localhost/api/execution-logs?offset=1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.offset).toBe(1);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].filename).toBe('exec-456-2024-01-02.log');
  });

  test('limitとoffsetの組み合わせでページネーションできること', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/execution-logs?limit=1&offset=1'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.offset).toBe(1);
    expect(body.limit).toBe(1);
    expect(body.files).toHaveLength(1);
  });
});

describe('GET /api/execution-logs/:executionId', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    mockGetExecutionLogFile.mockClear();
  });

  test('存在しないログファイルで404を返すこと', async () => {
    mockGetExecutionLogFile.mockImplementation(() => Promise.resolve(null));

    const res = await app.handle(new Request('http://localhost/api/execution-logs/999'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('No log file found');
  });

  test('不正なexecutionIdで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/api/execution-logs/invalid'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid execution ID');
  });
});
