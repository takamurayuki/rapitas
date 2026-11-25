/**
 * client-source-header.test
 *
 * The X-Rapitas-Source tag APIClient puts on each request. Moved out of
 * client.test.ts (over the size limit) when task 1548 changed the values:
 * mutations send `ui`, reads send `ui-poll` unless the caller marks them
 * `userAction: true`, and a caller-provided value always wins. No timing is
 * involved: a poll that fires right after a click is still `ui-poll`.
 */
import { APIClient, UI_SOURCE_HEADER, UI_SOURCE_VALUE } from '../client';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const mockOfflineFetch = vi.fn();
vi.mock('@/lib/offline-queue', () => ({
  offlineFetch: (...args: unknown[]) => mockOfflineFetch(...args),
}));

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const sentSource = (calls: unknown[][]): string | undefined =>
  ((calls[0] as [string, RequestInit])[1].headers as Record<string, string>)[UI_SOURCE_HEADER];

beforeEach(() => {
  localStorage.clear();
  mockOfflineFetch.mockReset();
});

describe('APIClient.performFetch - X-Rapitas-Source header', () => {
  it('バックグラウンドのGETには X-Rapitas-Source: ui-poll を付与すること', async () => {
    mockOfflineFetch.mockResolvedValue(okResponse({ id: 1 }));
    await new APIClient().fetch('/tasks/1', { skipCache: true });
    expect(sentSource(mockOfflineFetch.mock.calls)).toBe('ui-poll');
  });

  it('userAction: true のGETには ui を付与し、userAction を fetch に渡さないこと', async () => {
    mockOfflineFetch.mockResolvedValue(okResponse({ id: 1 }));
    await new APIClient().fetch('/tasks/1', { skipCache: true, userAction: true });
    expect(sentSource(mockOfflineFetch.mock.calls)).toBe(UI_SOURCE_VALUE);
    const init = (mockOfflineFetch.mock.calls[0] as [string, RequestInit])[1];
    expect('userAction' in init).toBe(false);
  });

  // Regression (Q1): the old 5 s window tagged a poll that fired just after a
  // click or key press as `ui`, so every interaction reopened the defer window.
  it.each([
    ['pointerdown', () => new Event('pointerdown')],
    ['keydown', () => new KeyboardEvent('keydown', { key: 'Enter' })],
  ])('%s の直後に発火した setInterval のポーリングは ui-poll のままであること', async (_n, ev) => {
    vi.useFakeTimers();
    try {
      mockOfflineFetch.mockResolvedValue(okResponse({ id: 1 }));
      const client = new APIClient();
      const timer = setInterval(() => void client.fetch('/tasks/1', { skipCache: true }), 1000);
      window.dispatchEvent(ev());
      await vi.advanceTimersByTimeAsync(1000);
      clearInterval(timer);
      expect(mockOfflineFetch).toHaveBeenCalledTimes(1);
      expect(sentSource(mockOfflineFetch.mock.calls)).toBe('ui-poll');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s リクエストには常に X-Rapitas-Source: ui を付与すること',
    async (method) => {
      mockOfflineFetch.mockResolvedValue(okResponse({ ok: true }));
      await new APIClient().fetch('/tasks', { method, body: '{}', skipCache: true });
      expect(sentSource(mockOfflineFetch.mock.calls)).toBe(UI_SOURCE_VALUE);
    },
  );

  it('呼び出し側が独自ヘッダを指定してもソースヘッダが維持されること', async () => {
    mockOfflineFetch.mockResolvedValue(okResponse({ id: 1 }));
    await new APIClient().fetch('/tasks/1', { skipCache: true, headers: { 'X-Custom': 'abc' } });

    const headers = (mockOfflineFetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<
      string,
      string
    >;
    expect(headers[UI_SOURCE_HEADER]).toBe('ui-poll');
    expect(headers['X-Custom']).toBe('abc');
  });

  it('呼び出し側は既存規約どおりソースヘッダを明示上書きできること', async () => {
    mockOfflineFetch.mockResolvedValue(okResponse({ id: 1 }));
    await new APIClient().fetch('/tasks/1', {
      skipCache: true,
      headers: { [UI_SOURCE_HEADER]: 'other' },
    });
    expect(sentSource(mockOfflineFetch.mock.calls)).toBe('other');
  });

  it('SSRフォールバック（native fetch）でもヘッダが付与されること', async () => {
    const nativeFetch = vi.fn().mockResolvedValue(okResponse({ id: 1 }));
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('fetch', nativeFetch);
    try {
      await new APIClient().fetch('/tasks/1', { skipCache: true });
      expect(sentSource(nativeFetch.mock.calls)).toBe('ui-poll');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
