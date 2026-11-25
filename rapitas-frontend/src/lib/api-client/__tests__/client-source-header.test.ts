/**
 * client-source-header.test
 *
 * The X-Rapitas-Source tag APIClient puts on each request. Moved out of
 * client.test.ts (over the size limit) when task 1548 changed the values:
 * mutations send `ui`, reads send `ui-poll` unless the user just clicked or
 * pressed a key, and a caller-provided value always wins.
 */
import { APIClient, UI_SOURCE_HEADER, UI_SOURCE_VALUE } from '../client';
import { noteUserInteraction, resetUserInteractionForTests } from '@/lib/api-headers';

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
  resetUserInteractionForTests();
  mockOfflineFetch.mockReset();
});

describe('APIClient.performFetch - X-Rapitas-Source header', () => {
  it('バックグラウンドのGETには X-Rapitas-Source: ui-poll を付与すること', async () => {
    mockOfflineFetch.mockResolvedValue(okResponse({ id: 1 }));
    await new APIClient().fetch('/tasks/1', { skipCache: true });
    expect(sentSource(mockOfflineFetch.mock.calls)).toBe('ui-poll');
  });

  it('クリック直後のGET（画面遷移）には ui を付与すること', async () => {
    mockOfflineFetch.mockResolvedValue(okResponse({ id: 1 }));
    noteUserInteraction();
    await new APIClient().fetch('/tasks/1', { skipCache: true });
    expect(sentSource(mockOfflineFetch.mock.calls)).toBe(UI_SOURCE_VALUE);
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
