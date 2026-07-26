/**
 * useTaskPreview
 *
 * State and network logic for TaskPreviewSection: start/stop the backend
 * preview session, poll screenshots while active, and relay click/keyboard/
 * scroll interactions to the live page. Split out of the component so the
 * view stays focused on rendering (COMPONENT_SPLITTING_POLICY.md — extract a
 * hook once state logic exceeds ~30 lines; this is well past that).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';

/** How often to re-fetch the screenshot while the preview is active. */
const SCREENSHOT_INTERVAL_MS = 3_000;

/** Fixed headless-browser viewport the backend launches (preview-session-manager.ts) — click coordinates are scaled against this, not the displayed <img> size. */
const PREVIEW_VIEWPORT = { width: 1280, height: 800 };

/** DOM KeyboardEvent.key values that don't match Playwright's key names 1:1. */
const KEY_NAME_OVERRIDES: Record<string, string> = { ' ': 'Space' };

export type PreviewState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'active'; url: string }
  | { phase: 'stopping'; url: string }
  | { phase: 'error'; message: string };

type PreviewInteraction =
  | { action: 'click'; x: number; y: number }
  | { action: 'type'; text: string }
  | { action: 'key'; key: string }
  | { action: 'scroll'; deltaX?: number; deltaY?: number };

/**
 * @param taskId - Task whose worktree to preview. / プレビュー対象タスクID
 */
export function useTaskPreview(taskId: number) {
  const t = useTranslations('task.preview');
  const [state, setState] = useState<PreviewState>({ phase: 'idle' });
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Drops overlapping interactions (mainly rapid-fire wheel events) instead
  // of queuing them — each interaction round-trips to the backend AND
  // triggers an immediate screenshot refetch, so flooding it would just pile
  // up latency with no visible benefit.
  const interactionBusyRef = useRef(false);
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

  /** Relay one interaction to the live page, then refetch the screenshot so its effect shows up immediately (not on the next 3s poll tick). */
  const sendInteraction = useCallback(
    async (interaction: PreviewInteraction) => {
      if (interactionBusyRef.current) return;
      interactionBusyRef.current = true;
      try {
        await fetch(`${API_BASE_URL}/tasks/${taskId}/preview/interact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(interaction),
        });
        await fetchScreenshot();
      } catch {
        /* best-effort — a dropped interaction just means this frame stays stale a beat longer */
      } finally {
        interactionBusyRef.current = false;
      }
    },
    [taskId, fetchScreenshot],
  );

  /** Click on the screenshot — scales displayed-image coordinates to the fixed headless-browser viewport before relaying. */
  const handlePreviewClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (state.phase !== 'active') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * PREVIEW_VIEWPORT.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * PREVIEW_VIEWPORT.height);
    void sendInteraction({ action: 'click', x, y });
  };

  /** Keyboard capture while the preview panel has focus — printable characters type, everything else relays as a named key press. */
  const handlePreviewKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (state.phase !== 'active') return;
    e.preventDefault();
    if (e.key.length === 1 && e.key !== ' ') {
      void sendInteraction({ action: 'type', text: e.key });
    } else {
      void sendInteraction({ action: 'key', key: KEY_NAME_OVERRIDES[e.key] ?? e.key });
    }
  };

  // Native (non-passive) wheel listener — React's synthetic onWheel is
  // passive by default, so e.preventDefault() there silently no-ops and the
  // HOST page scrolls along with the remote one. Attaching manually lets us
  // actually stop that and relay only the remote scroll.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || state.phase !== 'active') return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      void sendInteraction({ action: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [state.phase, sendInteraction]);

  // Restore state if a preview is already running (e.g. navigated back to
  // this task, or a hard page reload). NOTE: deliberately no "stop on
  // unmount" effect — one used to fire a stop request whenever this
  // component unmounted (reload, navigating away), which killed the very
  // session this restore logic is trying to find on the next mount. The
  // backend's own 15-minute idle sweep (preview-session-manager.ts's
  // IDLE_TIMEOUT_MS) is the safety net for a truly-abandoned preview;
  // don't reintroduce an unmount-triggered stop here.
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

  const handleStart = async () => {
    const myRequestId = ++requestIdRef.current;
    setState({ phase: 'starting' });
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/preview/start`, {
        method: 'POST',
      });
      const body = (await res.json()) as { success: boolean; url?: string; error?: string };
      // The user may have clicked Stop (or Start again) while this request
      // was in flight — starting a dev server + browser genuinely takes
      // tens of seconds, and the backend keeps working even after a client
      // gives up. Applying a stale response here would silently resurrect
      // a session the user already asked to stop.
      if (myRequestId !== requestIdRef.current) return;
      if (body.success && body.url) {
        setState({ phase: 'active', url: body.url });
      } else {
        setState({ phase: 'error', message: body.error ?? t('startFailed') });
      }
    } catch {
      if (myRequestId !== requestIdRef.current) return;
      setState({ phase: 'error', message: t('startFailed') });
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

  return {
    state,
    imgSrc,
    containerRef,
    handleStart,
    handleStop,
    handlePreviewClick,
    handlePreviewKeyDown,
  };
}
