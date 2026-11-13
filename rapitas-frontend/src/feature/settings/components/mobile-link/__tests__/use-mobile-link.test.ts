/**
 * use-mobile-link.test (#1421)
 *
 * The hook talks to /mobile-link, and takes the QR code off screen as soon as
 * a new phone has spent it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMobileLink, type MobileLinkStatus } from '../use-mobile-link';

let calls: { method: string; url: string }[] = [];
let status: MobileLinkStatus;

const device = (id: string) => ({
  id,
  name: id,
  workspaceId: null,
  createdAt: '2026-11-07T00:00:00Z',
  lastSeenAt: null,
});

beforeEach(() => {
  calls = [];
  status = {
    enabled: false,
    listening: false,
    lastError: null,
    desktopId: 'desk',
    desktopName: 'pc',
    port: 3002,
    addresses: [],
    devices: [],
  };
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    let data: unknown = status;
    if (url.endsWith('/enable')) status = { ...status, enabled: true, listening: true };
    if (url.endsWith('/disable')) status = { ...status, enabled: false, listening: false };
    if (url.endsWith('/enable') || url.endsWith('/disable')) data = status;
    if (url.endsWith('/pairing'))
      data = { uri: 'rapitas://pair?d=x', svg: '<svg/>', expiresAt: '2026-11-07T00:05:00Z' };
    if (method === 'DELETE') {
      status = { ...status, devices: status.devices.filter((d) => !url.endsWith(d.id)) };
      data = { success: true };
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
    } as Response);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('useMobileLink', () => {
  it('loads, enables and shows a QR code', async () => {
    const { result } = renderHook(() => useMobileLink());
    await waitFor(() => expect(result.current.status?.enabled).toBe(false));

    await act(() => result.current.setEnabled(true));
    expect(result.current.status?.listening).toBe(true);

    await act(() => result.current.showQr());
    expect(result.current.qr?.uri).toBe('rapitas://pair?d=x');
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/mobile-link/pairing'))).toBe(
      true,
    );
  });

  it('hides the QR code once a new phone has paired', async () => {
    const { result } = renderHook(() => useMobileLink());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    await act(() => result.current.setEnabled(true));
    await act(() => result.current.showQr());
    expect(result.current.qr).not.toBeNull();

    status = { ...status, devices: [device('iphone')] };
    await act(() => result.current.reload());
    expect(result.current.qr).toBeNull();
    expect(result.current.status?.devices).toHaveLength(1);
  });

  it('turning the link off drops the QR code', async () => {
    const { result } = renderHook(() => useMobileLink());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    await act(() => result.current.setEnabled(true));
    await act(() => result.current.showQr());
    await act(() => result.current.setEnabled(false));
    expect(result.current.qr).toBeNull();
  });

  it('revoke removes a phone and reloads', async () => {
    status = { ...status, devices: [device('d1')] };
    const { result } = renderHook(() => useMobileLink());
    await waitFor(() => expect(result.current.status?.devices).toHaveLength(1));
    await act(() => result.current.revoke('d1'));
    expect(
      calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/mobile-link/devices/d1')),
    ).toBe(true);
    expect(result.current.status?.devices).toHaveLength(0);
  });
});
