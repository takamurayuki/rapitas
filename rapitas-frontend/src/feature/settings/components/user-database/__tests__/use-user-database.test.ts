/**
 * use-user-database.test (#1285)
 *
 * The settings hook talks to /system/user-database. Initialization is only
 * ever sent with confirmed:true from the explicit action, and every change
 * leaves the "restart needed" flag set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useUserDatabase } from '../use-user-database';

let calls: { method: string; url: string; body: unknown }[] = [];
let status = {
  configured: false,
  url: null as string | null,
  initializedAt: null as string | null,
  active: false,
};

beforeEach(() => {
  calls = [];
  status = { configured: false, url: null, initializedAt: null, active: false };
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    let answer: { status: number; data: unknown } = { status: 200, data: status };
    if (method === 'PUT') {
      status = {
        configured: true,
        url: 'postgresql://a:***@h/db',
        initializedAt: null,
        active: false,
      };
      answer = { status: 200, data: { success: true } };
    } else if (url.endsWith('/measure')) {
      answer = {
        status: 200,
        data: { success: true, samples: 10, medianMs: 24.5, p90Ms: 31, hasSchema: false },
      };
    } else if (url.endsWith('/initialize')) {
      status = { ...status, initializedAt: '2026-11-03T00:00:00Z' };
      answer = { status: 200, data: { success: true, restartRequired: true } };
    } else if (method === 'DELETE') {
      status = { configured: false, url: null, initializedAt: null, active: false };
      answer = { status: 200, data: { success: true, restartRequired: true } };
    }
    return Promise.resolve({
      ok: answer.status < 400,
      status: answer.status,
      json: () => Promise.resolve(answer.data),
    } as Response);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('useUserDatabase', () => {
  it('loads the status on mount', async () => {
    const { result } = renderHook(() => useUserDatabase());
    await waitFor(() => expect(result.current.status?.configured).toBe(false));
  });

  it('save sends the URL and reloads the masked status', async () => {
    const { result } = renderHook(() => useUserDatabase());
    await act(() => result.current.save('postgresql://a:secret@h/db'));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      url: 'postgresql://a:secret@h/db',
    });
    await waitFor(() => expect(result.current.status?.url).toBe('postgresql://a:***@h/db'));
    expect(result.current.restartRequired).toBe(true);
  });

  it('measure reports the round trip', async () => {
    const { result } = renderHook(() => useUserDatabase());
    await act(() => result.current.measure());
    expect(result.current.latency).toMatchObject({ medianMs: 24.5, p90Ms: 31, hasSchema: false });
  });

  it('initialize is sent confirmed and marks the database initialized', async () => {
    const { result } = renderHook(() => useUserDatabase());
    await act(() => result.current.save('postgresql://a:secret@h/db'));
    await act(() => result.current.initialize());
    expect(calls.find((c) => c.url.endsWith('/initialize'))?.body).toEqual({ confirmed: true });
    await waitFor(() => expect(result.current.status?.initializedAt).not.toBeNull());
  });

  it('clear goes back to local and asks for a restart', async () => {
    const { result } = renderHook(() => useUserDatabase());
    await act(() => result.current.save('postgresql://a:secret@h/db'));
    await act(() => result.current.clear());
    await waitFor(() => expect(result.current.status?.configured).toBe(false));
    expect(result.current.restartRequired).toBe(true);
  });
});
