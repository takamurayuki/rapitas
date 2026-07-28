/**
 * usePreviewInteraction
 *
 * Relays click/keyboard/scroll interactions from the embedded preview panel
 * to the live headless page, and special-cases native <select> elements (see
 * handlePreviewClick's doc comment for why a raw click can't operate one).
 * Split out of useTaskPreview.ts, which owns session lifecycle/polling only
 * (COMPONENT_SPLITTING_POLICY.md — extract a hook once state logic exceeds
 * ~30 lines; combined the two exceeded 300 lines).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

/** Fixed headless-browser viewport the backend launches (preview-session-manager.ts) — click coordinates are scaled against this, not the displayed <img> size. */
const PREVIEW_VIEWPORT = { width: 1280, height: 800 };

/** DOM KeyboardEvent.key values that don't match Playwright's key names 1:1. */
const KEY_NAME_OVERRIDES: Record<string, string> = { ' ': 'Space' };

type PreviewInteraction =
  | { action: 'click'; x: number; y: number }
  | { action: 'type'; text: string }
  | { action: 'key'; key: string }
  | { action: 'scroll'; deltaX?: number; deltaY?: number }
  | { action: 'select'; x: number; y: number; value: string };

export interface SelectOption {
  value: string;
  label: string;
  selected: boolean;
  disabled: boolean;
}

/**
 * A native <select> was clicked — its dropdown can't be screenshotted, so we
 * render our own instead of relaying the click. Positioned/sized from the
 * select's own on-page bounding box (scaled to display pixels), not the raw
 * click point — anchoring to the click alone drifted from the real select
 * the instant the click landed anywhere but its exact top-left corner.
 */
export interface SelectOverlayState {
  /** Left/top/width of the select itself in display (CSS) pixels — the overlay renders flush under this box, matching where a real dropdown would appear. */
  left: number;
  top: number;
  width: number;
  /** Page-space coordinates (fixed 1280x800 viewport) of the original click, for the eventual select relay (re-locates the same <select> via elementFromPoint). */
  pageX: number;
  pageY: number;
  options: SelectOption[];
}

/**
 * @param taskId - Task whose preview to interact with. / プレビュー対象タスクID
 * @param isActive - Whether a live session is running (interactions are no-ops otherwise). / セッションが起動中か
 * @param containerRef - The preview panel's container, for attaching the native wheel listener. / パネルのコンテナ
 * @param fetchScreenshot - Refetches the screenshot — called after every interaction so its effect shows up immediately. / スクリーンショット再取得
 */
export function usePreviewInteraction(
  taskId: number,
  isActive: boolean,
  containerRef: React.RefObject<HTMLDivElement | null>,
  fetchScreenshot: () => Promise<void>,
) {
  const [selectOverlay, setSelectOverlay] = useState<SelectOverlayState | null>(null);
  // Drops overlapping interactions (mainly rapid-fire wheel events) instead
  // of queuing them — each interaction round-trips to the backend AND
  // triggers an immediate screenshot refetch, so flooding it would just pile
  // up latency with no visible benefit.
  const interactionBusyRef = useRef(false);

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

  /**
   * Click on the screenshot — scales displayed-image coordinates to the
   * fixed headless-browser viewport, then checks whether the point is a
   * native <select> BEFORE relaying anything: a <select>'s dropdown is drawn
   * by the OS/browser chrome, not the page, so it never appears in a
   * screenshot and a raw click can't pick an option in it. If so, show our
   * own dropdown overlay instead of relaying the click at all.
   */
  const handlePreviewClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isActive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const displayX = e.clientX - rect.left;
    const displayY = e.clientY - rect.top;
    const pageX = Math.round((displayX / rect.width) * PREVIEW_VIEWPORT.width);
    const pageY = Math.round((displayY / rect.height) * PREVIEW_VIEWPORT.height);

    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/preview/inspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: pageX, y: pageY }),
      });
      const body = (await res.json()) as {
        success: boolean;
        isSelect?: boolean;
        rect?: { x: number; y: number; width: number; height: number };
        options?: SelectOption[];
      };
      if (body.success && body.isSelect && body.options) {
        const scaleX = rect.width / PREVIEW_VIEWPORT.width;
        const scaleY = rect.height / PREVIEW_VIEWPORT.height;
        // Anchor the overlay to the select's own box (scaled to display
        // pixels), flush under its bottom edge — falls back to the click
        // point only if an older backend didn't send `rect`.
        const overlayLeft = body.rect ? body.rect.x * scaleX : displayX;
        const overlayTop = body.rect ? (body.rect.y + body.rect.height) * scaleY : displayY;
        const overlayWidth = body.rect ? body.rect.width * scaleX : 0;
        setSelectOverlay({
          left: overlayLeft,
          top: overlayTop,
          width: overlayWidth,
          pageX,
          pageY,
          options: body.options,
        });
        return;
      }
    } catch {
      // Inspect failed — fall through to a normal click. Missing the select
      // special-case occasionally is better than the click doing nothing.
    }
    void sendInteraction({ action: 'click', x: pageX, y: pageY });
  };

  /** User picked an option from our own overlay — relay it as a direct value set, bypassing the native dropdown entirely. */
  const handleSelectOption = (value: string) => {
    if (!selectOverlay) return;
    const { pageX, pageY } = selectOverlay;
    setSelectOverlay(null);
    void sendInteraction({ action: 'select', x: pageX, y: pageY, value });
  };

  /** Dismiss the overlay without choosing (e.g. clicking outside it). */
  const closeSelectOverlay = () => setSelectOverlay(null);

  /** Keyboard capture while the preview panel has focus — printable characters type, everything else relays as a named key press. */
  const handlePreviewKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isActive) return;
    e.preventDefault();
    if (e.key.length === 1 && e.key !== ' ') {
      void sendInteraction({ action: 'type', text: e.key });
    } else {
      void sendInteraction({ action: 'key', key: KEY_NAME_OVERRIDES[e.key] ?? e.key });
    }
  };

  // Dismiss any open select overlay once the session stops being active
  // (stopped, errored, etc.) — nothing left to relay a choice to.
  useEffect(() => {
    if (!isActive) setSelectOverlay(null);
  }, [isActive]);

  // Native (non-passive) wheel listener — React's synthetic onWheel is
  // passive by default, so e.preventDefault() there silently no-ops and the
  // HOST page scrolls along with the remote one. Attaching manually lets us
  // actually stop that and relay only the remote scroll.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isActive) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      void sendInteraction({ action: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isActive, containerRef, sendInteraction]);

  return {
    selectOverlay,
    handlePreviewClick,
    handlePreviewKeyDown,
    handleSelectOption,
    closeSelectOverlay,
  };
}
