'use client';
/**
 * useMobileLink
 *
 * Settings state for pairing phones with this desktop (#1421), over
 * /mobile-link: status, turning the LAN gateway on/off, issuing a pairing QR
 * code and removing a paired phone.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

export interface MobileLinkDevice {
  id: string;
  name: string;
  workspaceId: number | null;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface MobileLinkStatus {
  enabled: boolean;
  listening: boolean;
  lastError: string | null;
  desktopId: string;
  desktopName: string;
  port: number;
  addresses: string[];
  devices: MobileLinkDevice[];
}

export interface PairingQr {
  uri: string;
  svg: string;
  expiresAt: string;
}

const BASE = `${API_BASE_URL}/mobile-link`;

async function call(method: string, path = '') {
  const res = await fetch(`${BASE}${path}`, { method, credentials: 'include' });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/**
 * Status and actions for the phone-link card.
 *
 * @returns State plus enable / disable / showQr / revoke / 状態と操作
 */
export function useMobileLink() {
  const [status, setStatus] = useState<MobileLinkStatus | null>(null);
  const [qr, setQr] = useState<PairingQr | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // How many phones were paired when the QR went up; one more means it was spent.
  const devicesWhenQrShown = useRef<number | null>(null);

  const run = useCallback(
    async (fn: () => Promise<{ ok: boolean; data: Record<string, unknown> }>) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        if (!r.ok) setError(String(r.data.error ?? 'error'));
        return r;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return { ok: false, data: {} };
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const reload = useCallback(async () => {
    const r = await call('GET').catch(() => null);
    if (!r?.ok) return;
    const next = r.data as unknown as MobileLinkStatus;
    setStatus(next);
    const baseline = devicesWhenQrShown.current;
    if (baseline !== null && next.devices.length > baseline) {
      devicesWhenQrShown.current = null;
      setQr(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A paired phone shows up in the list as soon as it spends the code; poll
  // only while a QR code is on screen, which is the one time that happens.
  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(() => void reload(), 3000);
    return () => clearInterval(timer);
  }, [qr, reload]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      const r = await run(() => call('POST', enabled ? '/enable' : '/disable'));
      if (r.ok) setStatus(r.data as unknown as MobileLinkStatus);
      if (!enabled) setQr(null);
    },
    [run],
  );

  const showQr = useCallback(async () => {
    const r = await run(() => call('POST', '/pairing'));
    if (r.ok) {
      devicesWhenQrShown.current = status?.devices.length ?? 0;
      setQr(r.data as unknown as PairingQr);
    }
  }, [run, status]);

  const revoke = useCallback(
    async (id: string) => {
      const r = await run(() => call('DELETE', `/devices/${encodeURIComponent(id)}`));
      if (r.ok) await reload();
    },
    [run, reload],
  );

  return { status, qr, busy, error, setEnabled, showQr, revoke, reload };
}
