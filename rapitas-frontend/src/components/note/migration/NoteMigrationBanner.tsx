'use client';
/**
 * NoteMigrationBanner
 *
 * The band at the top of the /notes page while this browser's notes move to
 * the server (design §5.3 step 7): the start (backup first), progress, the
 * differences to decide, a failure with a resume, and the end. Also shows a
 * note save or load the server refused. Draws only; the state comes from
 * `useNoteMigration` and the note store.
 */
import { useTranslations } from 'next-intl';
import { CloudUpload, Download, TriangleAlert, X } from 'lucide-react';
import { useNoteStore } from '@/stores/note-store';
import type { NoteMigrationControls } from './useNoteMigration';
import NoteMigrationDiffList from './NoteMigrationDiffList';
import NoteMigrationBlockedList from './NoteMigrationBlockedList';

const BAND =
  'mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-zinc-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-zinc-200';

/**
 * The migration band and the note sync error line.
 *
 * @param migration - The migration state and actions / 移行の状態と操作
 */
export default function NoteMigrationBanner({ migration }: { migration: NoteMigrationControls }) {
  const t = useTranslations('notes.migration');
  const ts = useTranslations('notes.sync');
  const syncError = useNoteStore((s) => s.syncError);
  const clearSyncError = useNoteStore((s) => s.clearSyncError);
  const { view } = migration;

  return (
    <>
      {syncError && (
        <div
          role="alert"
          className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" />
          <span className="flex-1">{ts(syncError)}</span>
          <button type="button" onClick={clearSyncError} aria-label={ts('dismiss')}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {view.kind !== 'hidden' && (
        <section className={BAND} data-testid="note-migration-banner" aria-live="polite">
          <div className="flex items-start gap-2.5">
            {view.kind === 'error' ? (
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            ) : (
              <CloudUpload className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            )}
            <div className="min-w-0 flex-1">
              {view.kind === 'notStarted' && (
                <>
                  <p className="font-medium text-zinc-800 dark:text-zinc-100">
                    {t('notStartedTitle')}
                  </p>
                  <p className="mt-0.5">{t('notStartedBody', { count: view.noteCount })}</p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {t('startHint')}
                  </p>
                  <button
                    type="button"
                    onClick={migration.start}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-600"
                  >
                    <Download className="h-4 w-4" />
                    {t('start')}
                  </button>
                </>
              )}

              {view.kind === 'running' && (
                <>
                  <p className="font-medium text-zinc-800 dark:text-zinc-100">
                    {view.total > 0
                      ? t('runningCount', { imported: view.imported, total: view.total })
                      : t('running')}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {t('resumeHint')}
                  </p>
                </>
              )}

              {view.kind === 'needsDecision' && view.blocked.length > 0 && (
                <NoteMigrationBlockedList
                  blocked={view.blocked}
                  onRetry={view.diffs.length === 0 ? migration.retry : undefined}
                />
              )}

              {view.kind === 'needsDecision' && view.diffs.length > 0 && (
                <NoteMigrationDiffList
                  key={view.diffs.map((d) => `${d.id}:${d.server.version}`).join('|')}
                  diffs={view.diffs}
                  onApply={(choices) => migration.apply(view.diffs, choices)}
                />
              )}

              {view.kind === 'error' && (
                <>
                  <p className="font-medium text-zinc-800 dark:text-zinc-100">{t('errorTitle')}</p>
                  <p className="mt-0.5 break-all text-xs text-zinc-500 dark:text-zinc-400">
                    {view.message}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {t('resumeHint')}
                  </p>
                  <button
                    type="button"
                    onClick={migration.retry}
                    className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-200"
                  >
                    {t('retry')}
                  </button>
                </>
              )}

              {view.kind === 'done' && (
                <>
                  <p className="font-medium text-zinc-800 dark:text-zinc-100">{t('doneTitle')}</p>
                  <p className="mt-0.5">{t('doneBody')}</p>
                  {view.rejectedLinks.length > 0 && (
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {t('rejectedLinks', { count: view.rejectedLinks.length })}
                    </p>
                  )}
                </>
              )}
            </div>
            {view.kind === 'done' && (
              <button type="button" onClick={migration.dismiss} aria-label={t('dismiss')}>
                <X className="h-4 w-4 text-zinc-400" />
              </button>
            )}
          </div>
        </section>
      )}
    </>
  );
}
