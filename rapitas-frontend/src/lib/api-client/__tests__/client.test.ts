import { APIClient, isTransientError } from '../client';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

// Drive performFetch's underlying transport. The client uses offlineFetch in a
// browser env; mock it so we can simulate a stalled-then-recovered GET.
const mockOfflineFetch = vi.fn();
vi.mock('@/lib/offline-queue', () => ({
  offlineFetch: (...args: unknown[]) => mockOfflineFetch(...args),
}));

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe('isTransientError', () => {
  it('flags timeout / network / 5xx as transient', () => {
    expect(isTransientError(new Error('Request timeout after 15000ms — GET /tasks/1'))).toBe(true);
    expect(isTransientError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransientError(new Error('API Error: 503 (GET /x) - down'))).toBe(true);
  });

  it('does NOT flag 4xx or arbitrary errors', () => {
    expect(isTransientError(new Error('API Error: 404 (GET /x) - missing'))).toBe(false);
    expect(isTransientError(new Error('boom'))).toBe(false);
  });
});

describe('APIClient GET retry', () => {
  beforeEach(() => {
    mockOfflineFetch.mockReset();
  });

  it('retries a transient timeout on a GET and recovers', async () => {
    mockOfflineFetch
      .mockRejectedValueOnce(new Error('Request timeout after 15000ms — GET /tasks/234'))
      .mockResolvedValueOnce(okResponse({ id: 234, title: 'ok' }));

    const client = new APIClient();
    const result = await client.fetch<{ id: number }>('/tasks/234', { skipCache: true });

    expect(result).toEqual({ id: 234, title: 'ok' });
    expect(mockOfflineFetch).toHaveBeenCalledTimes(2); // first stalled, retry succeeded
  });

  it('does not retry non-transient (4xx) errors', async () => {
    mockOfflineFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    } as unknown as Response);

    const client = new APIClient();
    await expect(client.fetch('/tasks/999', { skipCache: true })).rejects.toThrow();
    expect(mockOfflineFetch).toHaveBeenCalledTimes(1); // no retry on 404
  });

  it('does not retry mutations', async () => {
    mockOfflineFetch.mockRejectedValue(new Error('Request timeout after 30000ms — POST /tasks'));

    const client = new APIClient();
    await expect(
      client.fetch('/tasks', { method: 'POST', body: '{}', skipCache: true }),
    ).rejects.toThrow();
    expect(mockOfflineFetch).toHaveBeenCalledTimes(1); // POST never retried
  });
});
