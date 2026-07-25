'use client';
/**
 * TaskPreviewSection
 *
 * Embedded live-preview panel: starts the task's worktree dev server (via
 * the backend's rapitas.runtime.json + Playwright preview session) and shows
 * a refreshing screenshot of it, so the user can see the running result
 * without leaving rapitas. Not an iframe (avoids per-project CSP/
 * X-Frame-Options breakage) and not a separate window (embedded panel was
 * the chosen UX). Dev-mode only — same gate as TaskWorkflowSection.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AppWindow, Play, Square, RefreshCw, AlertCircle } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { Spinner } from '@/components/ui/spinner';

/** How often to re-fetch the screenshot while the preview is active. */
const SCREENSHOT_INTERVAL_MS = 3_000;

interface TaskPreviewSectionProps {
  taskId: number;
}

type PreviewState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'active'; url: string }
  | { phase: 'error'; message: string };

/**
 * @param taskId - Task whose worktree to preview. / プレビュー対象タスクID
 */
export default function TaskPreviewSection({ taskId }: TaskPreviewSectionProps) {
  const t = useTranslations('task.preview');
  const [state, setState] = useState<PreviewState>({ phase: 'idle' });
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchScreenshot = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/preview/screenshot`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = url;
      setImgSrc(url);
    } catch {
      /* transient — keep the last frame on screen, retry next tick */
    }
  }, [taskId]);

  // Restore state if a preview is already running (e.g. navigated back to this task).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/preview/status`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { active: boolean; url?: string };
        if (body.active && body.url) setState({ phase: 'active', url: body.url });
      } catch {
        /* best-effort restore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Poll screenshots while active.
  useEffect(() => {
    if (state.phase !== 'active') return;
    fetchScreenshot();
    pollRef.current = setInterval(fetchScreenshot, SCREENSHOT_INTERVAL_MS);
    return clearPoll;
  }, [state.phase, fetchScreenshot, clearPoll]);

  // Revoke the last object URL on unmount so it doesn't leak.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  // Best-effort stop on unmount — navigating away shouldn't leave the dev
  // server running until the backend's own idle sweep eventually catches it.
  useEffect(() => {
    return () => {
      if (stateRef.current.phase === 'active') {
        fetch(`${API_BASE_URL}/tasks/${taskId}/preview/stop`, { method: 'POST' }).catch(() => {});
      }
    };
  }, [taskId]);

  const handleStart = async () => {
    setState({ phase: 'starting' });
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/preview/start`, {
        method: 'POST',
      });
      const body = (await res.json()) as { success: boolean; url?: string; error?: string };
      if (body.success && body.url) {
        setState({ phase: 'active', url: body.url });
      } else {
        setState({ phase: 'error', message: body.error ?? t('startFailed') });
      }
    } catch {
      setState({ phase: 'error', message: t('startFailed') });
    }
  };

  const handleStop = async () => {
    clearPoll();
    setState({ phase: 'idle' });
    setImgSrc(null);
    try {
      await fetch(`${API_BASE_URL}/tasks/${taskId}/preview/stop`, { method: 'POST' });
    } catch {
      /* best-effort */
    }
  };

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
        {state.phase === 'active' ? (
          <button
            onClick={handleStop}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Square className="h-3.5 w-3.5" />
            {t('stop')}
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={state.phase === 'starting'}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {state.phase === 'starting' ? <Spinner size="sm" /> : <Play className="h-3.5 w-3.5" />}
            {state.phase === 'starting' ? t('starting') : t('start')}
          </button>
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
        {state.phase === 'active' && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-50 dark:bg-zinc-900">
            {imgSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- refreshing local blob URL, not a static/remote asset next/image can optimize
              <img src={imgSrc} alt={t('screenshotAlt')} className="w-full h-auto block" />
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {t('loadingScreenshot')}
              </div>
            )}
            <div className="px-3 py-1.5 text-[11px] text-zinc-500 dark:text-zinc-500 border-t border-zinc-200 dark:border-zinc-800">
              {state.url}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
