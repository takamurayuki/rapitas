'use client';
/**
 * useUserDatabase
 *
 * Settings state for using one's own PostgreSQL database (#1285): status,
 * save, measure, initialize and going back to local, over
 * /system/user-database. The URL is sent once on save and never read back —
 * the server only ever returns the masked form.
 */
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

export interface UserDatabaseStatus {
  configured: boolean;
  /** Masked: the password never comes back. */
  url: string | null;
  initializedAt: string | null;
  /** Whether the running backend is on it (switching needs a restart). */
  active: boolean;
}

export interface Latency {
  samples: number;
  medianMs: number;
  p90Ms: number;
  hasSchema: boolean;
}

const BASE = `${API_BASE_URL}/system/user-database`;

async function call(method: string, path = '', body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/**
 * Status and actions for the user database card.
 *
 * @returns State plus save / measure / initialize / clear / 状態と操作
 */
export function useUserDatabase() {
  const [status, setStatus] = useState<UserDatabaseStatus | null>(null);
  const [latency, setLatency] = useState<Latency | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'measure' | 'initialize' | 'clear'>(null);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);

  const reload = useCallback(async () => {
    const r = await call('GET');
    if (r.ok) setStatus(r.data as unknown as UserDatabaseStatus);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (
      kind: NonNullable<typeof busy>,
      fn: () => Promise<{ ok: boolean; data: Record<string, unknown> }>,
    ) => {
      setBusy(kind);
      setError(null);
      try {
        const r = await fn();
        if (!r.ok) setError(String(r.data.error ?? 'error'));
        return r;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const save = useCallback(
    async (url: string) => {
      const r = await run('save', () => call('PUT', '', { url }));
      if (r.ok) {
        setLatency(null);
        setRestartRequired(true);
        await reload();
      }
    },
    [run, reload],
  );

  const measure = useCallback(async () => {
    const r = await run('measure', () => call('POST', '/measure'));
    if (r.ok) setLatency(r.data as unknown as Latency);
  }, [run]);

  const initialize = useCallback(async () => {
    const r = await run('initialize', () => call('POST', '/initialize', { confirmed: true }));
    if (r.ok) {
      setRestartRequired(true);
      await reload();
    }
  }, [run, reload]);

  const clear = useCallback(async () => {
    const r = await run('clear', () => call('DELETE'));
    if (r.ok) {
      setLatency(null);
      setRestartRequired(true);
      await reload();
    }
  }, [run, reload]);

  return { status, latency, busy, error, restartRequired, save, measure, initialize, clear };
}
