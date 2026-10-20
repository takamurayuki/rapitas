'use client';
/**
 * RapiAvatarPanel
 *
 * What the avatar opens: the running and interrupted executions, with the
 * actions that were on the resumable-executions banner.
 *
 * That banner used to sit in the corner permanently, saying the same thing
 * the avatar now says and taking the same space. The card is gone; its
 * contents live here, one click away, so nothing it could do was lost —
 * resuming an interrupted execution is reachable nowhere else in the app.
 *
 * Draws only. The data and the actions come from `useResumableExecutions`,
 * which the host owns so it runs once.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { ExecutionItem } from '../resumable-executions/ExecutionItem';
import type { ResumableExecution } from '../resumable-executions/types';
import { TaskBulkCleanup, TaskCleanup, TaskIntake } from './intake';

interface RapiAvatarPanelProps {
  executions: ResumableExecution[];
  resumingIds: Set<number>;
  dismissingIds: Set<number>;
  runningCount: number;
  interruptedCount: number;
  onResume: (id: number) => void;
  onResumeAll: () => void;
  onDismiss: (id: number) => void;
  formatTimeAgo: (dateString: string) => string;
  onClose: () => void;
  /** Lifted clear of the avatar below it. / アバターの上に出す余白 */
  bottomPx: number;
}

/**
 * @param props - The executions to show and what can be done with them
 */
export function RapiAvatarPanel({
  executions,
  resumingIds,
  dismissingIds,
  runningCount,
  interruptedCount,
  onResume,
  onResumeAll,
  onDismiss,
  formatTimeAgo,
  onClose,
  bottomPx,
}: RapiAvatarPanelProps) {
  const t = useTranslations('banner');
  const ta = useTranslations('rapiAvatar');
  const tm = useTranslations('rapiAvatar.mode');

  // Two explicit modes rather than guessing from the sentence. Working out
  // whether "重複しているタスク" means add one or delete several is a
  // classification that can be wrong, and being wrong about it deletes
  // things.
  const [mode, setMode] = useState<'create' | 'cleanup' | 'bulk'>('create');

  // With nothing running there is no list to head, so the panel is simply
  // ラピ. Repeating the intake's own heading here would say it twice.
  const heading =
    runningCount > 0
      ? t('inProgressWork')
      : interruptedCount > 0
        ? t('interruptedWork')
        : ta('name');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label={heading}
      style={{ right: 24, bottom: bottomPx, pointerEvents: 'auto' }}
      className="fixed z-[55] flex max-h-[60vh] w-80 flex-col rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <h2 className="flex-1 text-xs font-semibold text-zinc-700 dark:text-zinc-200">{heading}</h2>
        <span className="text-[11px] text-zinc-400">
          {runningCount > 0 && t('runningCount', { count: runningCount })}
          {runningCount > 0 && interruptedCount > 0 && ' / '}
          {interruptedCount > 0 && t('resumableCount', { count: interruptedCount })}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('closeAll')}
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex gap-1 border-b border-zinc-200 px-2 pt-2 dark:border-zinc-700">
          {(['create', 'cleanup', 'bulk'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`rounded-t-md px-2.5 py-1 text-xs transition-colors ${
                mode === value
                  ? 'bg-zinc-100 font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {tm(value)}
            </button>
          ))}
        </div>

        {mode === 'create' && <TaskIntake />}
        {mode === 'cleanup' && <TaskCleanup />}
        {mode === 'bulk' && <TaskBulkCleanup />}
        <div className="space-y-2 p-2">
          {executions.map((exec) => (
            <ExecutionItem
              key={exec.id}
              exec={exec}
              isResuming={resumingIds.has(exec.id)}
              isDismissing={dismissingIds.has(exec.id)}
              onResume={onResume}
              onDismiss={onDismiss}
              formatTimeAgo={formatTimeAgo}
            />
          ))}
        </div>
      </div>

      {/* Only offered when there is something to resume — everything
          running is already on its way. */}
      {interruptedCount > 0 && (
        <div className="shrink-0 border-t border-zinc-200 p-2 dark:border-zinc-700">
          <button
            type="button"
            onClick={onResumeAll}
            className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
          >
            {t('resumeAll')}
          </button>
        </div>
      )}
    </div>
  );
}
