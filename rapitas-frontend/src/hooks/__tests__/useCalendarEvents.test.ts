import { renderHook, waitFor, act } from '@testing-library/react';
import { useCalendarEvents } from '../study/useCalendarEvents';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    transientError: vi.fn(),
  }),
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

describe('useCalendarEvents', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches events on mount', async () => {
    const events = [
      { id: 1, title: 'Meeting', startAt: '2026-01-01', endAt: '2026-01-01', allDay: true },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ events }) }),
    );

    const { result } = renderHook(() => useCalendarEvents());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.events).toEqual(events);
  });

  it('handles a plain-array response (no events wrapper)', async () => {
    const events = [
      { id: 2, title: 'Standalone', startAt: '2026-01-02', endAt: '2026-01-02', allDay: false },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(events) }),
    );

    const { result } = renderHook(() => useCalendarEvents());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.events).toEqual(events);
  });

  it('leaves events empty on a fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { result } = renderHook(() => useCalendarEvents());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.events).toEqual([]);
  });

  it('addEvent posts the input and appends the created event', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ events: [] }) }); // initial fetch
    const created = { id: 5, title: 'New', startAt: 'a', endAt: 'b', allDay: false };
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(created) }); // addEvent
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCalendarEvents());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addEvent({ title: 'New', startAt: 'a', endAt: 'b' });
    });

    expect(result.current.events).toContainEqual(created);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/calendar/events',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('addEvent throws and does not modify events on failure', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ events: [] }) });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCalendarEvents());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.addEvent({ title: 'Bad', startAt: 'a', endAt: 'b' });
      }),
    ).rejects.toThrow();
    expect(result.current.events).toEqual([]);
  });

  it('removeEvent deletes and filters the event out locally', async () => {
    const initial = [{ id: 1, title: 'A', startAt: 'a', endAt: 'b', allDay: false }];
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ events: initial }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCalendarEvents());
    await waitFor(() => expect(result.current.events).toEqual(initial));

    await act(async () => {
      await result.current.removeEvent(1);
    });

    expect(result.current.events).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/calendar/events/1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('refreshEvents re-triggers a fetch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ events: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCalendarEvents());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const callsBefore = fetchMock.mock.calls.length;
    await act(async () => {
      await result.current.refreshEvents();
    });

    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1);
  });
});
