/**
 * URL Metadata Routes テスト
 * URLメタデータ取得APIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import { Elysia } from 'elysia';

// Save original fetch and mock it
const originalFetch = globalThis.fetch;
const mockFetch = mock(() =>
  Promise.resolve(
    new Response('<html><head><title>Test Title</title></head><body></body></html>', {
      status: 200,
    }),
  ),
);
globalThis.fetch = mockFetch as unknown as typeof fetch;

const { urlMetadataRoutes } = await import('../../../routes/system/url-metadata');

// Restore fetch after all tests
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function createApp() {
  return new Elysia().use(urlMetadataRoutes);
}

describe('POST /url-metadata', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response('<html><head><title>Test Title</title></head><body></body></html>', {
          status: 200,
        }),
      ),
    );
    app = createApp();
  });

  test('有効なURLでtitle, favicon, url, domainを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/url-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/page' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe('Test Title');
    expect(body.favicon).toContain('example.com');
    expect(body.url).toBe('https://example.com/page');
    expect(body.domain).toBe('example.com');
  });

  test('無効なURLでフォールバック値を返すこと', async () => {
    const invalidUrl = 'not-a-valid-url';

    const res = await app.handle(
      new Request('http://localhost/url-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: invalidUrl }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe(invalidUrl);
    expect(body.favicon).toBe('');
    expect(body.domain).toBe('');
  });
});
