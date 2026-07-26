'use client';
/**
 * TaskPreviewSection
 *
 * Embedded live-preview panel: starts the task's worktree dev server (via
 * the backend's rapitas.runtime.json + Playwright preview session) and shows
 * a refreshing screenshot of it, so the user can see the running result
 * without leaving rapitas — and interact with it directly (click, type,
 * scroll), relayed to the real headless page. Not an iframe (avoids
 * per-project CSP/X-Frame-Options breakage) and not a separate window
 * (embedded panel was the chosen UX). Dev-mode only — same gate as
 * TaskWorkflowSection. State/network logic lives in useTaskPreview.ts.
 */
import { useTranslations } from 'next-intl';
import { AppWindow, Play, Square, RefreshCw, AlertCircle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { PillButton } from '@/components/ui/pill-button';
import { useTaskPreview } from './useTaskPreview';

interface TaskPreviewSectionProps {
  taskId: number;
}

/**
 * @param taskId - Task whose worktree to preview. / プレビュー対象タスクID
 */
export default function TaskPreviewSection({ taskId }: TaskPreviewSectionProps) {
  const t = useTranslations('task.preview');
  const {
    state,
    imgSrc,
    containerRef,
    selectOverlay,
    handleStart,
    handleStop,
    handlePreviewClick,
    handlePreviewKeyDown,
    handleSelectOption,
    closeSelectOverlay,
  } = useTaskPreview(taskId);

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-lg border border-zinc-200 dark:border-zinc-800 mb-6">
      <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AppWindow className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h3>
          {state.phase === 'active' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-900/30 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
              {t('liveBadge')}
            </span>
          )}
        </div>
        {state.phase === 'active' || state.phase === 'starting' ? (
          // Stop is offered during 'starting' too — the dev server + browser
          // launch genuinely takes tens of seconds, and previously there was
          // no way to cancel a stuck/slow attempt short of navigating away
          // (which didn't even stop it server-side; see preview-session-
          // manager.ts's `pending` tracking for the backend half of this).
          <PillButton icon={Square} color="zinc" onClick={handleStop}>
            {t('stop')}
          </PillButton>
        ) : state.phase === 'stopping' ? (
          // Disabled during the transitional stop — nothing to cancel back
          // into, and a second click would just race the in-flight request.
          <PillButton icon={Square} color="zinc" onClick={() => {}} disabled>
            {t('stopping')}
          </PillButton>
        ) : (
          <PillButton icon={Play} color="indigo" onClick={handleStart}>
            {t('start')}
          </PillButton>
        )}
      </div>

      <div className="p-4">
        {state.phase === 'idle' && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('idleHint')}</p>
        )}
        {state.phase === 'starting' && (
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Spinner size="sm" />
            {t('startingHint')}
          </div>
        )}
        {state.phase === 'error' && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{state.message}</span>
          </div>
        )}
        {(state.phase === 'active' || state.phase === 'stopping') && (
          /* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events --
             This is a remote-control surface for a real headless browser tab, not a
             standard page widget: the div's keydown/focus captures keyboard input FOR
             the remote page (role="application" signals its own interaction model),
             and the image's click relays a raw pixel coordinate via mouse.click(x,y),
             which has no keyboard equivalent to bind. */
          <div
            ref={containerRef}
            tabIndex={0}
            role="application"
            aria-label={t('interactHint')}
            onKeyDown={handlePreviewKeyDown}
            className="relative rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {imgSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- refreshing local blob URL, not a static/remote asset next/image can optimize
              <img
                src={imgSrc}
                alt={t('screenshotAlt')}
                onClick={handlePreviewClick}
                className={`w-full h-auto block ${state.phase === 'active' ? 'cursor-pointer' : 'cursor-default opacity-40 transition-opacity duration-300'}`}
              />
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {t('loadingScreenshot')}
              </div>
            )}
            {state.phase === 'stopping' && (
              // Overlaid on the dimmed last frame instead of replacing it —
              // makes clear this is a deliberate, in-progress stop rather
              // than the preview having abruptly vanished on its own.
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex items-center gap-2 rounded-full bg-white/90 dark:bg-zinc-900/90 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 shadow">
                  <Spinner size="sm" />
                  {t('stoppingHint')}
                </div>
              </div>
            )}
            {selectOverlay && (
              // A native <select>'s own dropdown is drawn by the OS/browser
              // chrome, not the page, so it never appears in the screenshot
              // and can't be operated by clicking on it. This is our own
              // stand-in, positioned at the click that triggered it.
              <>
                <button
                  type="button"
                  aria-label={t('closeSelectOverlay')}
                  onClick={closeSelectOverlay}
                  className="absolute inset-0 z-10 cursor-default"
                />
                <div
                  role="listbox"
                  className="absolute z-20 max-h-48 min-w-[8rem] overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
                  style={{ left: selectOverlay.displayX, top: selectOverlay.displayY }}
                >
                  {selectOverlay.options.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={opt.selected}
                      onClick={() => handleSelectOption(opt.value)}
                      className={`block w-full truncate px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                        opt.selected
                          ? 'font-medium text-indigo-600 dark:text-indigo-400'
                          : 'text-zinc-700 dark:text-zinc-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="px-3 py-1.5 text-[11px] text-zinc-500 dark:text-zinc-500 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
              <span>{state.url}</span>
              {state.phase === 'active' && (
                <span className="text-zinc-400 dark:text-zinc-600">{t('interactHint')}</span>
              )}
            </div>
          </div>
          /* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */
        )}
      </div>
    </div>
  );
}
