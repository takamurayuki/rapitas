import { renderHook, waitFor, act } from '@testing-library/react';
import { useOfflineQueue } from '../common/useOfflineQueue';

const mockGetQueueStatus = vi.fn();
const mockSyncQueue = vi.fn();
const mockClearQueue = vi.fn();
const mockSubscribeToQueue = vi.fn();

vi.mock('@/lib/offline-queue', () => ({
  getQueueStatus: (...args: unknown[]) => mockGetQueueStatus(...args),
  syncQueue: (...args: unknown[]) => mockSyncQueue(...args),
  clearQueue: (...args: unknown[]) => mockClearQueue(...args),
  subscribeToQueue: (...args: unknown[]) => mockSubscribeToQueue(...args),
}));

describe('useOfflineQueue', () => {
  const defaultStatus = { pendingCount: 0, isSyncing: false, lastSyncAt: null, lastError: null };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetQueueStatus.mockReset().mockResolvedValue(defaultStatus);
    mockSyncQueue.mockReset().mockResolvedValue(0);
    mockClearQueue.mockReset().mockResolvedValue(undefined);
    mockSubscribeToQueue.mockReset().mockReturnValue(() => {});
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('loads the initial status on mount', async () => {
    mockGetQueueStatus.mockResolvedValue({
      pendingCount: 3,
      isSyncing: false,
      lastSyncAt: '2026-01-01T00:00:00Z',
      lastError: null,
    });

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.pendingCount).toBe(3));
    expect(result.current.lastSyncAt).toBe('2026-01-01T00:00:00Z');
  });

  it('reflects navigator.onLine at mount', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const { result } = renderHook(() => useOfflineQueue());
    expect(result.current.isOnline).toBe(false);
  });

  it('subscribes to queue changes and refreshes on notification', async () => {
    let notifyFn: (() => void) | undefined;
    mockSubscribeToQueue.mockImplementation((fn: () => void) => {
      notifyFn = fn;
      return () => {};
    });
    mockGetQueueStatus.mockResolvedValueOnce(defaultStatus).mockResolvedValueOnce({
      pendingCount: 5,
      isSyncing: false,
      lastSyncAt: null,
      lastError: null,
    });

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.pendingCount).toBe(0));

    await act(async () => {
      notifyFn?.();
    });

    await waitFor(() => expect(result.current.pendingCount).toBe(5));
  });

  it('sync() calls syncQueue then refreshes status', async () => {
    mockSyncQueue.mockResolvedValue(2);
    mockGetQueueStatus.mockResolvedValueOnce(defaultStatus).mockResolvedValueOnce({
      pendingCount: 0,
      isSyncing: false,
      lastSyncAt: 'now',
      lastError: null,
    });

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.pendingCount).toBe(0));

    let count;
    await act(async () => {
      count = await result.current.sync();
    });

    expect(count).toBe(2);
    expect(mockSyncQueue).toHaveBeenCalled();
  });

  it('clear() calls clearQueue then refreshes status', async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(mockGetQueueStatus).toHaveBeenCalled());

    await act(async () => {
      await result.current.clear();
    });

    expect(mockClearQueue).toHaveBeenCalled();
    expect(mockGetQueueStatus).toHaveBeenCalledTimes(2); // initial + after clear
  });

  it('tracks online/offline events', async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(mockGetQueueStatus).toHaveBeenCalled());

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.isOnline).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.isOnline).toBe(true);
  });

  it('unsubscribes and removes listeners on unmount', async () => {
    const unsub = vi.fn();
    mockSubscribeToQueue.mockReturnValue(unsub);
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(mockGetQueueStatus).toHaveBeenCalled());
    unmount();

    expect(unsub).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));
  });
});
