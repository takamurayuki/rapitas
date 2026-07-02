'use client';
/**
 * RecentErrorsCard
 *
 * Surfaces the backend ring-buffer (uncaught + frontend + explicit errors)
 * so the user can see what is breaking without tailing logs.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, RefreshCw, Trash2, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

interface CapturedError {
  id: string;
  source: 'uncaughtException' | 'unhandledRejection' | 'explicit' | 'frontend';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

interface ErrorsResponse {
  sentryEnabled: boolean;
  errors: CapturedError[];
}

/**
 * Returns the translated badge label for an error source.
 *
 * @param source - The captured error's origin.
 * @param t - Scoped translation function from `settings.recentErrorsCard`.
 * @returns The label text to display in the source badge.
 */
function getSourceLabel(
  source: CapturedError['source'],
  t: ReturnType<typeof useTranslations>,
): string {
  switch (source) {
    case 'uncaughtException':
      return t('sourceUncaughtException');
    case 'unhandledRejection':
      return t('sourceUnhandledRejection');
    case 'explicit':
      return t('sourceExplicit');
    case 'frontend':
      return t('sourceFrontend');
  }
}

export default function RecentErrorsCard() {
  const t = useTranslations('settings.recentErrorsCard');
  const [data, setData] = useState<ErrorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/system/errors`);
      if (res.ok) setData((await res.json()) as ErrorsResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const clear = async () => {
    await fetch(`${API_BASE_URL}/system/errors`, { method: 'DELETE' });
    await refresh();
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h2>
          {data?.sentryEnabled && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              {t('sentryConnected')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={t('reload')}
            title={t('reload')}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={clear}
            className="rounded p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
            aria-label={t('clear')}
            title={t('clear')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{t('description')}</p>

      {loading ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        </div>
      ) : !data?.errors.length ? (
        <p className="text-xs text-green-600 dark:text-green-400">{t('noErrors')}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {data.errors.map((e) => (
            <li key={e.id} className="py-2 text-xs">
              <button
                onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                className="flex w-full items-start gap-2 text-left"
              >
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    e.source === 'frontend'
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  }`}
                >
                  {getSourceLabel(e.source, t)}
                </span>
                <span className="flex-1 truncate font-mono text-zinc-700 dark:text-zinc-300">
                  {e.message}
                </span>
                <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
                  {new Date(e.timestamp).toLocaleTimeString('ja-JP')}
                </span>
              </button>
              {expanded === e.id && e.stack && (
                <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-zinc-50 p-2 text-[10px] leading-relaxed text-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
                  {e.stack}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
