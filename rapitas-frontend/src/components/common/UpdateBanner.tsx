'use client';
/**
 * UpdateBanner
 *
 * Checks for a Tauri auto-update on mount and offers a one-click apply.
 * No-op outside the Tauri runtime (web mode).
 */
import { useEffect, useState } from 'react';
import { Download, X, Loader2 } from 'lucide-react';
import { isTauri } from '@/utils/tauri';
import { createLogger } from '@/lib/logger';

const log = createLogger('UpdateBanner');

interface PendingUpdate {
  version: string;
  notes?: string;
  /** Reference to the loaded `Update` instance from @tauri-apps/plugin-updater. */
  apply: () => Promise<void>;
}

const DISMISS_KEY = 'rapitas:update-dismissed-version';

export default function UpdateBanner() {
  const [pending, setPending] = useState<PendingUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!update || cancelled) return;

        const dismissed = localStorage.getItem(DISMISS_KEY);
        if (dismissed === update.version) return;

        setPending({
          version: update.version,
          notes: update.body,
          apply: async () => {
            let total = 0;
            let done = 0;
            await update.downloadAndInstall((event) => {
              if (event.event === 'Started') {
                total = event.data.contentLength ?? 0;
                setProgress({ done: 0, total });
              } else if (event.event === 'Progress') {
                done += event.data.chunkLength;
                setProgress({ done, total });
              } else if (event.event === 'Finished') {
                setProgress({ done: total, total });
              }
            });
            const { relaunch } = await import('@tauri-apps/plugin-process');
            await relaunch();
          },
        });
      } catch (err) {
        log.warn('Update check failed', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!pending) return null;

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] max-w-sm rounded-xl border border-indigo-200 bg-white shadow-lg dark:border-indigo-700 dark:bg-zinc-900">
      <div className="flex items-start gap-3 p-4">
        <Download className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            アップデート v{pending.version} が利用可能
          </p>
          {pending.notes && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-3">
              {pending.notes}
            </p>
          )}
          {installing && (
            <div className="mt-2 space-y-1">
              <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div
                  className="h-full bg-indigo-500 transition-all"
                  style={{ width: pct === null ? '40%' : `${pct}%` }}
                />
              </div>
              <p className="text-[10px] text-zinc-500">
                {pct === null ? 'ダウンロード中…' : `${pct}% 完了`}
              </p>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={async () => {
                if (installing) return;
                setInstalling(true);
                try {
                  await pending.apply();
                } catch (err) {
                  log.error('Update install failed', err);
                  setInstalling(false);
                }
              }}
              disabled={installing}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {installing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {installing ? 'インストール中…' : '今すぐ更新'}
            </button>
            <button
              onClick={() => {
                localStorage.setItem(DISMISS_KEY, pending.version);
                setPending(null);
              }}
              disabled={installing}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              後で
            </button>
          </div>
        </div>
        <button
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, pending.version);
            setPending(null);
          }}
          disabled={installing}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="閉じる"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
