/**
 * Screenshots Routes テスト
 * スクリーンショットAPIのユニットテスト
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

// Mock screenshot-service
const mockCaptureScreenshots = mock(() =>
  Promise.resolve([
    {
      url: 'http://localhost:3000',
      path: '/uploads/screenshots/test.png',
      success: true,
    },
  ]),
);

const mockCaptureAllScreenshots = mock(() =>
  Promise.resolve([
    {
      url: 'http://localhost:3000',
      path: '/uploads/screenshots/test.png',
      success: true,
    },
  ]),
);

const mockDetectProjectInfo = mock(() => ({
  framework: 'nextjs',
  name: 'test-project',
}));

const mockDetectAllPages = mock(() => [{ path: '/', name: 'Home' }]);

mock.module('../../../services/misc/screenshot-service', () => ({
  captureScreenshots: mockCaptureScreenshots,
  captureAllScreenshots: mockCaptureAllScreenshots,
  detectProjectInfo: mockDetectProjectInfo,
  detectAllPages: mockDetectAllPages,
}));

const { screenshotsRoutes } = await import('../../../routes/system/screenshots');

function createApp() {
  return new Elysia().use(screenshotsRoutes);
}

describe('GET /screenshots/:filename', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  test('パストラバーサルを含むファイル名で400を返すこと (..)', async () => {
    const res = await app.handle(new Request('http://localhost/screenshots/..%2Fetc%2Fpasswd'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid filename');
  });

  test('スラッシュを含むファイル名で400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/screenshots/path%2Ffile.png'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid filename');
  });

  test('バックスラッシュを含むファイル名で400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/screenshots/path%5Cfile.png'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid filename');
  });
});

describe('POST /screenshots/detect-pages', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    mockDetectAllPages.mockClear();
    mockDetectProjectInfo.mockClear();
  });

  test('workingDirectoryを指定してページ一覧を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/screenshots/detect-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDirectory: '/path/to/project' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.pages).toBeDefined();
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0].path).toBe('/');
    expect(body.totalPages).toBe(1);
    expect(body.project).toBeDefined();
  });

  test('workingDirectoryが未指定の場合エラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/screenshots/detect-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toBe('workingDirectory is required');
  });
});

describe('POST /screenshots/detect-project', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    mockDetectProjectInfo.mockClear();
  });

  test('workingDirectoryを指定してプロジェクト情報を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/screenshots/detect-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDirectory: '/path/to/project' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.project).toBeDefined();
    expect(body.project.framework).toBe('nextjs');
    expect(body.project.name).toBe('test-project');
  });

  test('workingDirectoryが未指定の場合エラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/screenshots/detect-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.error).toBe('workingDirectory is required');
  });
});

describe('POST /screenshots/capture', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    mockCaptureScreenshots.mockClear();
  });

  test('スクリーンショット撮影が成功すること', async () => {
    const res = await app.handle(
      new Request('http://localhost/screenshots/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: ['http://localhost:3000'],
          workingDirectory: '/path/to/project',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.screenshots).toHaveLength(1);
    expect(body.screenshots[0].success).toBe(true);
  });

  test('撮影エラー時にエラーレスポンスを返すこと', async () => {
    mockCaptureScreenshots.mockImplementation(() =>
      Promise.reject(new Error('Browser launch failed')),
    );

    const res = await app.handle(
      new Request('http://localhost/screenshots/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: ['http://localhost:3000'],
          workingDirectory: '/path/to/project',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Browser launch failed');
  });
});

describe('POST /screenshots/capture-all', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    mockCaptureAllScreenshots.mockClear();
  });

  test('workingDirectoryが未指定の場合エラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/screenshots/capture-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toBe('workingDirectory is required');
  });

  test('全ページスクリーンショット撮影が成功すること', async () => {
    const res = await app.handle(
      new Request('http://localhost/screenshots/capture-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDirectory: '/path/to/project' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.screenshots).toHaveLength(1);
  });
});
