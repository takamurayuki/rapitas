/**
 * useTaskPreview
 *
 * Session lifecycle and network logic for TaskPreviewSection: start/stop the
 * backend preview session, restore an already-running session on mount, and
 * poll screenshots while active. Interaction relaying (click/keyboard/scroll/
 * select) lives in usePreviewInteraction.ts, composed in here so the view
 * only needs one hook call (COMPONENT_SPLITTING_POLICY.md — extract a hook
 * once state logic exceeds ~30 lines; the combined logic exceeded 300 lines).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { usePreviewInteraction } from './usePreviewInteraction';

/** How often to re-fetch the screenshot while the preview is active. */
const SCREENSHOT_INTERVAL_MS = 3_000;

export type PreviewState =
  | { phase: 'checking' }
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'active'; url: string }
  | { phase: 'stopping'; url: string }
  | { phase: 'error'; message: string; reason?: string };

/** Failure reasons fixable from the task-detail panel itself, without leaving the page. */
const CONFIGURABLE_REASONS = new Set(['not_configured', 'config_error']);

export interface RuntimeConfigEditorState {
  hasTheme: boolean;
  value: string;
  saving: boolean;
  saveError: string | null;
}

/**
 * @param taskId - Task whose worktree to preview. / プレビュー対象タスクID
 */
export function useTaskPreview(taskId: number) {
  const t = useTranslations('task.preview');
  const [state, setState] = useState<PreviewState>({ phase: 'checking' });
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [configEditor, setConfigEditor] = useState<RuntimeConfigEditorState | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Display mode for the settings modal's test Start button — headless
  // (default, embedded screenshot view) or a real, visible OS browser
  // window. Purely a modal concern: the main Start button never sets this,
  // so it always keeps the original headless behavior.
  const [headlessMode, setHeadlessMode] = useState(true);
  const objectUrlRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Bumped by handleStart/handleStop — lets a still-in-flight handleStart
  // notice it's been superseded (the user clicked Stop, or clicked Start
  // again) and skip applying its now-stale response, instead of reviving a
  // session the user already asked to stop.
  const requestIdRef = useRef(0);

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

  const interaction = usePreviewInteraction(
    taskId,
    state.phase === 'active',
    containerRef,
    fetchScreenshot,
  );

  // Restore state if a preview is already running (e.g. navigated back to
  // this task, or a hard page reload) — starts from 'checking' (not 'idle')
  // so the idle Start button never flashes on screen first, only to be
  // replaced by the active view a moment later once this resolves. Always
  // resolves to either 'active' or 'idle', even on failure — 'checking'
  // must never be a dead end. NOTE: deliberately no "stop on unmount" effect
  // — one used to fire a stop request whenever this component unmounted
  // (reload, navigating away), which killed the very session this restore
  // logic is trying to find on the next mount. The backend's own 15-minute
  // idle sweep (preview-session-manager.ts's IDLE_TIMEOUT_MS) is the safety
  // net for a truly-abandoned preview; don't reintroduce an
  // unmount-triggered stop here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/preview/status`);
        if (cancelled) return;
        if (!res.ok) {
          setState({ phase: 'idle' });
          return;
        }
        const body = (await res.json()) as { active: boolean; url?: string };
        setState(body.active && body.url ? { phase: 'active', url: body.url } : { phase: 'idle' });
      } catch {
        if (!cancelled) setState({ phase: 'idle' });
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

  /**
   * @param opts.headless - Explicit `false` opens a real, visible browser
   *   window (the settings modal's "normal display" test mode) instead of
   *   the default embedded/headless view. / 通常表示モード
   */
  const handleStart = async (opts?: { headless?: boolean }) => {
    const myRequestId = ++requestIdRef.current;
    setState({ phase: 'starting' });
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/preview/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: opts?.headless }),
      });
      const body = (await res.json()) as {
        success: boolean;
        url?: string;
        error?: string;
        reason?: string;
      };
      // The user may have clicked Stop (or Start again) while this request
      // was in flight — starting a dev server + browser genuinely takes
      // tens of seconds, and the backend keeps working even after a client
      // gives up. Applying a stale response here would silently resurrect
      // a session the user already asked to stop.
      if (myRequestId !== requestIdRef.current) return;
      if (body.success && body.url) {
        setState({ phase: 'active', url: body.url });
      } else {
        setState({ phase: 'error', message: body.error ?? t('startFailed'), reason: body.reason });
      }
    } catch {
      if (myRequestId !== requestIdRef.current) return;
      setState({ phase: 'error', message: t('startFailed') });
    }
  };

  // Lets the user fix a missing/broken preview config (the two
  // CONFIGURABLE_REASONS) — or just tweak it and test — inline instead of
  // leaving the task detail page for the theme settings form. Pre-fills from
  // the theme's current value (if any) via the same GET the theme form
  // itself doesn't need, since it reads from its own already-loaded Theme
  // object. Callable any time, not just after a failed start.
  const openSettings = async () => {
    setIsSettingsOpen(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/preview/runtime-config`);
      const body = (await res.json()) as { hasTheme: boolean; runtimeConfigJson: string | null };
      setConfigEditor({
        hasTheme: body.hasTheme,
        value: body.runtimeConfigJson ?? '',
        saving: false,
        saveError: null,
      });
    } catch {
      setConfigEditor({ hasTheme: false, value: '', saving: false, saveError: null });
    }
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
    setConfigEditor(null);
  };

  const setConfigValue = (value: string) => {
    setConfigEditor((prev) => (prev ? { ...prev, value } : prev));
  };

  /**
   * Save only — starting/stopping the test session is a separate, explicit
   * action in the modal. Closes the modal on success (nothing left to do);
   * on failure, stays open with the error shown so the user can retry.
   */
  const saveConfig = async () => {
    if (!configEditor) return;
    setConfigEditor({ ...configEditor, saving: true, saveError: null });
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/preview/runtime-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeConfigJson: configEditor.value }),
      });
      const body = (await res.json()) as { success: boolean; error?: string };
      if (body.success) {
        closeSettings();
        return;
      }
      setConfigEditor((prev) =>
        prev ? { ...prev, saving: false, saveError: body.error ?? t('saveFailed') } : prev,
      );
    } catch {
      setConfigEditor((prev) =>
        prev ? { ...prev, saving: false, saveError: t('saveFailed') } : prev,
      );
    }
  };

  const handleStop = async () => {
    requestIdRef.current++; // invalidate any in-flight handleStart's response
    clearPoll();
    // Transition through a "stopping" state that keeps showing the last
    // screenshot (dimmed, with a spinner) instead of jumping straight to the
    // idle placeholder — an instant cut felt to the user like the screen had
    // "reverted on its own" rather than a deliberate stop they just asked
    // for. Only applies when there's actually a screenshot to fade (i.e. was
    // 'active'); cancelling mid-'starting' has nothing to show and goes
    // straight to idle as before.
    if (state.phase === 'active') {
      setState({ phase: 'stopping', url: state.url });
    }
    // Previously set phase: 'idle' immediately, before the request even
    // fired, and swallowed any failure — a CSRF block, timeout, or any other
    // network error left the backend session running while the UI silently
    // reported "stopped." Only clear to idle once the backend confirms the
    // stop actually happened; surface a failure instead of hiding it.
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/preview/stop`, {
        method: 'POST',
      });
      if (!res.ok) {
        setState({ phase: 'error', message: t('stopFailed') });
        return;
      }
      setState({ phase: 'idle' });
      setImgSrc(null);
    } catch {
      setState({ phase: 'error', message: t('stopFailed') });
    }
  };

  const isConfigurable = state.phase === 'error' && CONFIGURABLE_REASONS.has(state.reason ?? '');

  return {
    state,
    imgSrc,
    containerRef,
    isConfigurable,
    isSettingsOpen,
    configEditor,
    headlessMode,
    setHeadlessMode,
    openSettings,
    closeSettings,
    setConfigValue,
    saveConfig,
    handleStart,
    handleStop,
    ...interaction,
  };
}
