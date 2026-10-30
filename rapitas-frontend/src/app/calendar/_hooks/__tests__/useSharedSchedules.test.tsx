/**
 * useSharedSchedules.test
 *
 * Reading someone else's shared month (#1270).
 *
 * Two things here are easy to get wrong and invisible when you do. The fetch
 * must carry the session cookie — every other read in this app works without
 * one because the backend serves sessionless requests unscoped, but these
 * endpoints answer 401, so a missing `credentials` makes the whole feature
 * look broken rather than unauthenticated. And a refusal must stay a refusal:
 * turned into an empty list, "they stopped sharing" looks exactly like "they
 * have nothing on".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSharedSchedules } from '../useSharedSchedules';

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://api.test',
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const JANUARY = new Date(2026, 0, 15);

function stubFetch(response: { ok: boolean; status?: number; body?: unknown }) {
  // Typed parameters so `mock.calls` is a real tuple: the assertions below
  // read the url and the init, and an untyped mock makes those index errors.
  const fetchMock = vi.fn(async (_url: string, _init?: { credentials?: string }) => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 403),
    json: async () => response.body ?? {},
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('reading a shared month', () => {
  it('sends the session cookie', async () => {
    const fetchMock = stubFetch({ ok: true, body: { events: [] } });
    renderHook(() => useSharedSchedules(9, JANUARY));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

  it('asks the share endpoint for that workspace', async () => {
    const fetchMock = stubFetch({ ok: true, body: { events: [] } });
    renderHook(() => useSharedSchedules(9, JANUARY));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'http://api.test/calendar-shares/9/schedules?from=',
    );
  });

  it('asks for a window around the month on screen', async () => {
    // A week of slack either side, so an event that began last month still
    // draws its bar into this one.
    const fetchMock = stubFetch({ ok: true, body: { events: [] } });
    renderHook(() => useSharedSchedules(9, JANUARY));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const from = new Date(url.searchParams.get('from') as string);
    const to = new Date(url.searchParams.get('to') as string);
    expect(from.getTime()).toBeLessThan(new Date(2026, 0, 1).getTime());
    expect(to.getTime()).toBeGreaterThan(new Date(2026, 0, 31).getTime());
  });

  it('maps the events into what the grid draws', async () => {
    stubFetch({
      ok: true,
      body: {
        events: [
          {
            id: 3,
            title: '相手の会議',
            startAt: '2026-01-20T09:00:00.000Z',
            endAt: '2026-01-20T10:00:00.000Z',
            isAllDay: false,
            color: '#4f46e5',
          },
        ],
      },
    });
    const { result } = renderHook(() => useSharedSchedules(9, JANUARY));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0]).toMatchObject({
      title: '相手の会議',
      date: '2026-01-20',
      time: '09:00',
      type: 'schedule',
    });
  });

  it('asks for nothing when looking at my own calendar', async () => {
    const fetchMock = stubFetch({ ok: true, body: { events: [] } });
    const { result } = renderHook(() => useSharedSchedules(null, JANUARY));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.events).toEqual([]);
  });
});

describe('when it is refused', () => {
  it('keeps the reason instead of showing an empty month', async () => {
    stubFetch({ ok: false, status: 403, body: { reason: 'not_shared' } });
    const { result } = renderHook(() => useSharedSchedules(9, JANUARY));
    await waitFor(() => expect(result.current.refusal).toBe('not_shared'));
    expect(result.current.events).toEqual([]);
  });

  it('falls back to a generic failure when the body says nothing', async () => {
    stubFetch({ ok: false, status: 500, body: {} });
    const { result } = renderHook(() => useSharedSchedules(9, JANUARY));
    await waitFor(() => expect(result.current.refusal).toBe('failed'));
  });

  it('reports a failure when the request itself throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const { result } = renderHook(() => useSharedSchedules(9, JANUARY));
    await waitFor(() => expect(result.current.refusal).toBe('failed'));
  });
});
