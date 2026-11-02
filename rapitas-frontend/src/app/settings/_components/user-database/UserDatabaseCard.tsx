'use client';
/**
 * UserDatabaseCard
 *
 * Settings card for keeping data in one's own PostgreSQL (#1285): save a
 * connection string, measure its round trip, initialize it once (only after
 * ticking that local data is not migrated), or go back to this device's
 * database. Every change says it applies after a restart — the database is
 * chosen at boot.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CloudCog } from 'lucide-react';
import { useUserDatabase } from './use-user-database';

export function UserDatabaseCard() {
  const t = useTranslations('settings.userDatabaseCard');
  const db = useUserDatabase();
  const [url, setUrl] = useState('');
  const [understood, setUnderstood] = useState(false);
  const s = db.status;

  const state = !s?.configured
    ? t('stateLocal')
    : s.active
      ? t('stateActive')
      : s.initializedAt
        ? t('stateInitialized')
        : t('stateSaved');

  return (
    <section className="rounded-xl border border-slate-200 p-5 dark:border-slate-700">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <CloudCog className="h-5 w-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-slate-500">{t('description')}</p>
      <p className="mt-3 text-sm font-medium" data-testid="user-db-state">
        {state}
        {s?.url && <span className="ml-2 font-mono text-xs text-slate-500">{s.url}</span>}
      </p>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void db.save(url).then(() => setUrl(''));
        }}
      >
        <label className="sr-only" htmlFor="user-db-url">
          {t('urlLabel')}
        </label>
        <input
          id="user-db-url"
          type="password"
          aria-label={t('urlLabel')}
          autoComplete="off"
          placeholder={t('urlLabel')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={!url.trim() || db.busy !== null}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {t('save')}
        </button>
      </form>

      {s?.configured && (
        <div className="mt-4 space-y-3 text-sm">
          <button
            type="button"
            onClick={() => void db.measure()}
            disabled={db.busy !== null}
            className="rounded-md border border-slate-300 px-3 py-1.5 dark:border-slate-600"
          >
            {t('measure')}
          </button>
          {db.latency && (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {t('latency', {
                median: db.latency.medianMs,
                p90: db.latency.p90Ms,
                samples: db.latency.samples,
              })}{' '}
              — {db.latency.hasSchema ? t('hasSchema') : t('noSchema')}
            </p>
          )}

          {!s.initializedAt && (
            <div className="rounded-md bg-amber-50 p-3 text-xs dark:bg-amber-900/20">
              <p>{t('initializeConfirm')}</p>
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={t('initializeConfirmCheck')}
                  checked={understood}
                  onChange={(e) => setUnderstood(e.target.checked)}
                />
                {t('initializeConfirmCheck')}
              </label>
              <button
                type="button"
                onClick={() => void db.initialize()}
                disabled={!understood || db.busy !== null}
                className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-white disabled:opacity-50"
              >
                {t('initialize')}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => void db.clear()}
            disabled={db.busy !== null}
            className="text-xs text-slate-600 underline dark:text-slate-300"
          >
            {t('clear')}
          </button>
        </div>
      )}

      {db.error && (
        <p className="mt-3 text-xs text-red-600">{t('errorPrefix', { error: db.error })}</p>
      )}
      {db.restartRequired && <p className="mt-3 text-xs text-indigo-700">{t('restart')}</p>}
      <p className="mt-2 text-xs text-slate-400">{t('escapeHatch')}</p>
    </section>
  );
}
