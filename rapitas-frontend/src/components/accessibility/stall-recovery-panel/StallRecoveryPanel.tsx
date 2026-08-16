/**
 * StallRecoveryPanel
 *
 * Accessible stall-recovery dialog (Ctrl+Alt+S): announces stalled tasks via
 * TTS + aria-live, walks the staged approval flow, and executes a recovery
 * action only after explicit Space/button confirmation. Keyboard-complete:
 * Tab (move) / Space (confirm) / Esc (back or close).
 */
'use client';

import { useEffect, useRef } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useFocusTrap } from '@/components/ui/modal/use-focus-trap';
import { useStallRecovery } from './use-stall-recovery';
import { DESTRUCTIVE_ACTIONS } from './stall-recovery.types';

export default function StallRecoveryPanel() {
  const t = useTranslations('stallRecovery');
  const tc = useTranslations('common');
  const panel = useStallRecovery();
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusTrap(panelRef, panel.isOpen);

  const { isOpen, step, executePending, goBack, closePanel } = panel;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (step === 'list') closePanel();
        else goBack();
        return;
      }
      // Space is THE approval key. Captured with preventDefault so a focused
      // button cannot double-fire (keydown here + native space activation).
      if (e.key === ' ' && step === 'confirm') {
        e.preventDefault();
        e.stopPropagation();
        void executePending();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, step, executePending, goBack, closePanel]);

  useEffect(() => {
    if (panel.isOpen) panelRef.current?.focus();
  }, [panel.isOpen, panel.step]);

  if (!panel.isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={panel.closePanel}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stall-recovery-title"
        tabIndex={-1}
        className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* aria-live mirror of every narration — the guaranteed text channel */}
        <div aria-live="assertive" role="status" className="sr-only">
          {panel.liveMessage}
        </div>

        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <h2
              id="stall-recovery-title"
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
            >
              {t('title')}
            </h2>
            {!panel.voiceActive && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded">
                {t('voiceUnavailable')}
              </span>
            )}
          </div>
          <button
            onClick={panel.closePanel}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg"
            aria-label={tc('close')}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
          {panel.isLoading && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('checking')}</p>
          )}

          {!panel.isLoading && panel.loadFailed && (
            <p className="text-sm text-red-600 dark:text-red-400">{t('checkFailed')}</p>
          )}

          {!panel.isLoading && !panel.loadFailed && panel.step === 'list' && (
            <>
              {panel.reports.length === 0 ? (
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{t('noStalledTasks')}</p>
              ) : (
                <ul aria-label={t('taskListLabel')} className="space-y-2">
                  {panel.reports.map((report) => (
                    <li key={report.taskId}>
                      <button
                        onClick={() => panel.selectTask(report)}
                        className="w-full text-left p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                      >
                        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          #{report.taskId} {report.title}
                        </span>
                        <span className="block text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                          {t('staleFor', { minutes: report.staleMinutes })}
                        </span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                          {report.cause}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {panel.step === 'actions' && panel.selectedTask && (
            <>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                <span className="font-medium">{t('causeLabel')}: </span>
                {panel.selectedTask.cause}
              </p>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t('actionsLabel')}
              </p>
              <ul className="space-y-2">
                {panel.selectedTask.suggestedActions.map((action) => {
                  const destructive = DESTRUCTIVE_ACTIONS.has(action);
                  return (
                    <li key={action}>
                      <button
                        onClick={() => panel.selectAction(action)}
                        className={`w-full flex items-center gap-2 text-left p-3 rounded-lg border transition-colors ${
                          destructive
                            ? 'border-red-300 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20'
                            : 'border-zinc-200 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                        }`}
                      >
                        {destructive && (
                          <AlertTriangle
                            className="w-4 h-4 text-red-500 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <span className="text-sm text-zinc-800 dark:text-zinc-200">
                          {t(`actions.${action}`)}
                        </span>
                        {destructive && (
                          <span className="ml-auto px-1.5 py-0.5 text-[10px] font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded">
                            {t('destructiveBadge')}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {panel.step === 'confirm' && panel.pendingAction && (
            <>
              <p className="text-sm text-zinc-900 dark:text-zinc-100">
                {t('confirmSelected', { action: t(`actions.${panel.pendingAction}`) })}
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('confirmPrompt')}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void panel.executePending()}
                  disabled={panel.isExecuting}
                  className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {panel.isExecuting ? t('executing') : t('executeWithSpace')}
                </button>
                <button
                  onClick={panel.goBack}
                  className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                >
                  {t('back')}
                </button>
              </div>
            </>
          )}

          {panel.step === 'result' && panel.result && (
            <>
              <p
                className={`text-sm ${
                  panel.result.success
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {panel.result.message}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={panel.goBack}
                  className="px-4 py-2 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 rounded-lg text-sm font-medium transition-colors"
                >
                  {t('back')}
                </button>
                <button
                  onClick={panel.closePanel}
                  className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                >
                  {t('close')}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="p-3 border-t border-zinc-200 dark:border-zinc-700 text-center">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('keyHint')}</p>
        </div>
      </div>
    </div>
  );
}
