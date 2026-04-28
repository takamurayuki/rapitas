'use client';
/**
 * header/restart-dialogs.tsx
 *
 * Modal dialogs used during server restart flows:
 * - Confirmation dialog shown when active agent executions exist.
 * - Blocking overlay shown while the server is restarting.
 */

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

type RestartDialogsProps = {
  /** State for the confirmation dialog. */
  restartConfirmDialog: { open: boolean; activeExecutions: number };
  /** Closes or resets the confirmation dialog. */
  setRestartConfirmDialog: (v: { open: boolean; activeExecutions: number }) => void;
  /** Proceeds with the restart even if executions are active. */
  executeRestart: () => Promise<void>;
  /** Whether the restart is currently in progress (shows blocking overlay). */
  isRestarting: boolean;
};

/**
 * Renders restart-related modal dialogs: confirmation prompt and progress overlay.
 * Returns null when neither dialog is active.
 */
export function RestartDialogs({
  restartConfirmDialog,
  setRestartConfirmDialog,
  executeRestart,
  isRestarting,
}: RestartDialogsProps) {
  const t = useTranslations('nav');
  const tc = useTranslations('common');

  return (
    <>
      {restartConfirmDialog.open && (
        <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-zinc-800 rounded-xl shadow-2xl p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              {t('restartConfirm')}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                {restartConfirmDialog.activeExecutions}
                {t('tasksUnit')}
              </span>{' '}
              {t('restartWarning')}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setRestartConfirmDialog({ open: false, activeExecutions: 0 })}
                className="px-4 py-2 text-sm rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                {tc('cancel')}
              </button>
              <button
                onClick={executeRestart}
                className="px-4 py-2 text-sm rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors"
              >
                {t('restart')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isRestarting && (
        <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-zinc-800 rounded-xl shadow-2xl p-8 flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('restartingOverlay')}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('restartingMessage')}</p>
          </div>
        </div>
      )}
    </>
  );
}
