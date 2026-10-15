import { renderHook, waitFor, act } from '@testing-library/react';
import { useAuthSession } from '../auth/useAuthSession';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    transientError: vi.fn(),
  }),
}));

const mockFetchWithRetry = vi.fn();
vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
  fetchWithRetry: (...args: unknown[]) => mockFetchWithRetry(...args),
}));

describe('useAuthSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockFetchWithRetry.mockReset();
  });

  it('checks the session on mount and sets authenticated state on success', async () => {
    mockFetchWithRetry.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 1, name: 'A', email: 'a@test.com' } }),
    });

    const { result } = renderHook(() => useAuthSession());
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual({ id: 1, name: 'A', email: 'a@test.com' });
  });

  it('sets unauthenticated state when the session check returns non-ok', async () => {
    mockFetchWithRetry.mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('sets unauthenticated state when the session check throws', async () => {
    mockFetchWithRetry.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
  });

  it('login posts credentials and updates state with the returned user', async () => {
    mockFetchWithRetry.mockResolvedValue({ ok: false }); // initial session check fails
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 2, name: 'B', email: 'b@test.com' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let user;
    await act(async () => {
      user = await result.current.login('b@test.com', 'pw');
    });

    expect(user).toEqual({ id: 2, name: 'B', email: 'b@test.com' });
    expect(result.current.isAuthenticated).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('login throws on a failed response', async () => {
    mockFetchWithRetry.mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.login('bad@test.com', 'wrong');
      }),
    ).rejects.toThrow('Login failed');
  });

  it('logout posts and resets to unauthenticated state', async () => {
    mockFetchWithRetry.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 1, name: 'A', email: 'a@test.com' } }),
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAuthSession());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
