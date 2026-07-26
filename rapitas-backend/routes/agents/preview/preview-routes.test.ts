/**
 * preview-routes.test.ts
 *
 * Unit tests for /tasks/:id/preview/{start,stop,status,screenshot} via
 * Elysia handle(). preview-session-manager is stubbed via mock.module
 * (process-global — run this file in isolation) since it does real
 * filesystem/process/browser work.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockStartPreview = mock(() =>
  Promise.resolve({ ok: true, url: 'http://localhost:1' }),
) as ReturnType<typeof mock>;
const mockStopPreview = mock(() => Promise.resolve()) as ReturnType<typeof mock>;
const mockGetPreviewStatus = mock(() => ({ active: false })) as ReturnType<typeof mock>;
const mockScreenshotPreview = mock(() =>
  Promise.resolve({ ok: true, buffer: Buffer.from([1, 2, 3]) }),
) as ReturnType<typeof mock>;
const mockInteractWithPreview = mock(() => Promise.resolve({ ok: true })) as ReturnType<
  typeof mock
>;

mock.module('../../../services/agents/preview/preview-session-manager', () => ({
  startPreview: mockStartPreview,
  stopPreview: mockStopPreview,
  getPreviewStatus: mockGetPreviewStatus,
  screenshotPreview: mockScreenshotPreview,
  interactWithPreview: mockInteractWithPreview,
}));

const { previewRoutes } = await import('./preview-routes');

const BASE = 'http://localhost/tasks';

function resetMocks() {
  mockStartPreview.mockReset();
  mockStopPreview.mockReset();
  mockGetPreviewStatus.mockReset();
  mockScreenshotPreview.mockReset();
  mockInteractWithPreview.mockReset();
  mockStartPreview.mockResolvedValue({ ok: true, url: 'http://localhost:1' });
  mockStopPreview.mockResolvedValue(undefined);
  mockGetPreviewStatus.mockReturnValue({ active: false });
  mockScreenshotPreview.mockResolvedValue({ ok: true, buffer: Buffer.from([1, 2, 3]) });
  mockInteractWithPreview.mockResolvedValue({ ok: true });
}

describe('POST /tasks/:id/preview/start', () => {
  beforeEach(resetMocks);

  it('成功時に success:true と url を返すこと', async () => {
    mockStartPreview.mockResolvedValue({ ok: true, url: 'http://localhost:5173' });

    const res = await previewRoutes.handle(
      new Request(`${BASE}/42/preview/start`, { method: 'POST' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.url).toBe('http://localhost:5173');
    expect(mockStartPreview).toHaveBeenCalledWith(42);
  });

  it('rapitas.runtime.json 未設定時は 422 + reason を返すこと', async () => {
    mockStartPreview.mockResolvedValue({
      ok: false,
      reason: 'not_configured',
      message: 'このプロジェクトには rapitas.runtime.json が設定されていません。',
    });

    const res = await previewRoutes.handle(
      new Request(`${BASE}/42/preview/start`, { method: 'POST' }),
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.success).toBe(false);
    expect(body.reason).toBe('not_configured');
  });

  it('不正なtask idは 400 を返し startPreview を呼ばないこと', async () => {
    const res = await previewRoutes.handle(
      new Request(`${BASE}/abc/preview/start`, { method: 'POST' }),
    );
    expect(res.status).toBe(400);
    expect(mockStartPreview).not.toHaveBeenCalled();
  });
});

describe('POST /tasks/:id/preview/stop', () => {
  beforeEach(resetMocks);

  it('stopPreview を呼び success:true を返すこと', async () => {
    const res = await previewRoutes.handle(
      new Request(`${BASE}/42/preview/stop`, { method: 'POST' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockStopPreview).toHaveBeenCalledWith(42);
  });
});

describe('GET /tasks/:id/preview/status', () => {
  beforeEach(resetMocks);

  it('起動中なら active:true と url を返すこと', async () => {
    mockGetPreviewStatus.mockReturnValue({
      active: true,
      url: 'http://localhost:5173',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    const res = await previewRoutes.handle(new Request(`${BASE}/42/preview/status`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.active).toBe(true);
    expect(body.url).toBe('http://localhost:5173');
  });

  it('未起動なら active:false を返すこと', async () => {
    mockGetPreviewStatus.mockReturnValue({ active: false });

    const res = await previewRoutes.handle(new Request(`${BASE}/42/preview/status`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.active).toBe(false);
  });
});

describe('GET /tasks/:id/preview/screenshot', () => {
  beforeEach(resetMocks);

  it('起動中なら image/png で画像を返すこと', async () => {
    mockScreenshotPreview.mockResolvedValue({ ok: true, buffer: Buffer.from([1, 2, 3, 4]) });

    const res = await previewRoutes.handle(new Request(`${BASE}/42/preview/screenshot`));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it('未起動なら 404 を返すこと', async () => {
    mockScreenshotPreview.mockResolvedValue({ ok: false, reason: 'not_active' });

    const res = await previewRoutes.handle(new Request(`${BASE}/42/preview/screenshot`));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBeDefined();
  });
});

describe('POST /tasks/:id/preview/interact', () => {
  beforeEach(resetMocks);

  it('クリック操作を interactWithPreview に委譲すること', async () => {
    const res = await previewRoutes.handle(
      new Request(`${BASE}/42/preview/interact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'click', x: 100, y: 200 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockInteractWithPreview).toHaveBeenCalledWith(42, { action: 'click', x: 100, y: 200 });
  });

  it('type操作を委譲すること', async () => {
    const res = await previewRoutes.handle(
      new Request(`${BASE}/42/preview/interact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'type', text: 'hello' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockInteractWithPreview).toHaveBeenCalledWith(42, { action: 'type', text: 'hello' });
  });

  it('未起動時は 404 を返すこと', async () => {
    mockInteractWithPreview.mockResolvedValue({ ok: false, reason: 'not_active' });

    const res = await previewRoutes.handle(
      new Request(`${BASE}/42/preview/interact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'key', key: 'Enter' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });

  it('不正な body は 422 (バリデーションエラー) を返し interactWithPreview を呼ばないこと', async () => {
    const res = await previewRoutes.handle(
      new Request(`${BASE}/42/preview/interact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unknown-action' }),
      }),
    );

    expect(res.status).toBe(422);
    expect(mockInteractWithPreview).not.toHaveBeenCalled();
  });
});
