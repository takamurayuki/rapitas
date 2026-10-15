'use client';

/**
 * SyncStateCard
 *
 * Calendar FreeBusy poller status (last sync, error, stale) plus the
 * connect and re-sync actions (task 1174). A failed or stale sync means the
 * gate is failing open, so it is shown prominently rather than hidden.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import type { SyncStateResponse } from './calendar-slots-types';

const STATUS_KEY: Record<SyncStateResponse['lastStatus'], string> = {
  ok: 'syncOk',
  error: 'syncError',
  never: 'syncNever',
};

export default function SyncStateCard({
  data,
  onSynced,
}: {
  data: SyncStateResponse;
  onSynced: () => void;
}) {
  const t = useTranslations('calendarSlots');
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    const res = await fetch(`${API_BASE_URL}/calendar-slots/oauth/url`);
    if (!res.ok) return;
    const { url } = (await res.json()) as { url: string };
    window.location.href = url;
  };

  const resync = async () => {
    setBusy(true);
    try {
      await fetch(`${API_BASE_URL}/calendar-slots/sync`, { method: 'POST' });
      onSynced();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('syncTitle')}</h2>
        <div className="flex gap-2">
          {data.lastStatus === 'error' ? (
            <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
              {t(STATUS_KEY[data.lastStatus])}
            </span>
          ) : (
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {t(STATUS_KEY[data.lastStatus])}
            </span>
          )}
          {data.stale && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              {t('stale')}
            </span>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-zinc-500 dark:text-zinc-400">{t('lastSyncedAt')}</dt>
        <dd className="text-zinc-900 dark:text-zinc-100">
          {data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString() : '—'}
        </dd>
        <dt className="text-zinc-500 dark:text-zinc-400">{t('pollMinutes')}</dt>
        <dd className="text-zinc-900 dark:text-zinc-100">{data.pollMinutes}</dd>
      </dl>
      {data.lastError && (
        <p className="mt-2 break-all rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {data.lastError}
        </p>
      )}
      {(data.lastStatus === 'error' || data.stale) && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t('failOpenNote')}</p>
      )}
      <div className="mt-3 flex gap-2">
        {!data.connected && (
          <button
            type="button"
            onClick={() => void connect()}
            className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            {t('connect')}
          </button>
        )}
        {data.connected && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void resync()}
            className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {t('resync')}
          </button>
        )}
      </div>
    </section>
  );
}
