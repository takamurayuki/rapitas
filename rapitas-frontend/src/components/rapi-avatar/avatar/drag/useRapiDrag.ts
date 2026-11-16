/**
 * useRapiDrag
 *
 * Lets ラピ be picked up with the pointer and put down anywhere in the
 * window, and remembers where she was left.
 *
 * Owns the pointer gesture, the held state and the landing cue, and
 * the stored position. Not responsible for drawing her or for placing the
 * panel — those read `position` and `viewport` from here.
 *
 * A press that does not travel is still a click. Her button toggles the
 * panel on click, and the click that ends a drag would otherwise open or
 * close it as she is put down; `consumeClick` is how the button tells the
 * two apart.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  DEFAULT_POSITION,
  clampPosition,
  moveBy,
  type AvatarPosition,
  type Viewport,
} from './rapi-placement';

/** Where her position is kept between visits. Per browser, not per account. */
export const POSITION_STORAGE_KEY = 'rapitas.rapiAvatar.position';

/**
 * How far the pointer must travel before a press becomes a drag.
 *
 * Small enough to feel immediate, large enough that a hand that trembles
 * while clicking does not pick her up by accident.
 */
export const DRAG_THRESHOLD_PX = 5;

/** Assumed until the first effect can read the real window (SSR). */
const FALLBACK_VIEWPORT: Viewport = { width: 1280, height: 800 };

function readStored(): AvatarPosition | null {
  try {
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<AvatarPosition>;
    return typeof v.right === 'number' && typeof v.bottom === 'number'
      ? { right: v.right, bottom: v.bottom }
      : null;
  } catch {
    return null;
  }
}

function writeStored(pos: AvatarPosition): void {
  try {
    window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // Private windows and blocked storage: she still moves, she just forgets.
  }
}

function readViewport(): Viewport {
  return typeof window === 'undefined'
    ? FALLBACK_VIEWPORT
    : { width: window.innerWidth, height: window.innerHeight };
}

/** What the button needs to be draggable. */
export interface RapiDragHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
}

export interface RapiDrag {
  position: AvatarPosition;
  viewport: Viewport;
  /** True while she is being held. / つままれている間 true */
  grabbed: boolean;
  /** Bumped each time she is put down, to replay the landing. / 着地のたびに増える */
  dropKey: number;
  handlers: RapiDragHandlers;
  /**
   * Call from the click handler; true means this click ended a drag and
   * should do nothing. / ドラッグ終了のクリックなら true
   */
  consumeClick: () => boolean;
}

interface Grab {
  pointerId: number;
  x: number;
  y: number;
  from: AvatarPosition;
  moved: boolean;
  /** Where the last move put her, so release can store it without a render. */
  to: AvatarPosition;
}

/**
 * Track ラピ's position and the gesture that moves her.
 *
 * @returns Her position, the held state, and the button's handlers / 位置・状態・ハンドラ
 */
export function useRapiDrag(): RapiDrag {
  const [position, setPosition] = useState<AvatarPosition>(DEFAULT_POSITION);
  const [viewport, setViewport] = useState<Viewport>(FALLBACK_VIEWPORT);
  const [grabbed, setGrabbed] = useState(false);
  const [dropKey, setDropKey] = useState(0);
  const grab = useRef<Grab | null>(null);
  const swallowClick = useRef(false);
  const latest = useRef(position);
  latest.current = position;

  // Read after mount, not in the initial state: the server has no window and
  // no storage, and a first render that differs between the two is a
  // hydration mismatch.
  useEffect(() => {
    const vp = readViewport();
    setViewport(vp);
    const stored = readStored();
    if (stored) setPosition(clampPosition(stored, vp));

    const onResize = () => {
      const next = readViewport();
      setViewport(next);
      setPosition((p) => clampPosition(p, next));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    grab.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      from: latest.current,
      moved: false,
      to: latest.current,
    };
    // Keeps the moves coming when the pointer outruns her, which it will.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const g = grab.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      setGrabbed(true);
    }
    g.to = moveBy(g.from, dx, dy, readViewport());
    setPosition(g.to);
  }, []);

  const finish = useCallback((e: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const g = grab.current;
    if (!g || g.pointerId !== e.pointerId) return;
    grab.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!g.moved) return;
    // The click that follows a pointerup is dispatched in the same task, so
    // the flag is dropped on the next one: a release that produces no click
    // (outside the window, a cancel) must not swallow the next real one.
    if (!cancelled) {
      swallowClick.current = true;
      setTimeout(() => {
        swallowClick.current = false;
      }, 0);
    }
    setGrabbed(false);
    setDropKey((n) => n + 1);
    writeStored(g.to);
  }, []);
  const onPointerUp = useCallback((e: PointerEvent<HTMLElement>) => finish(e, false), [finish]);
  const onPointerCancel = useCallback((e: PointerEvent<HTMLElement>) => finish(e, true), [finish]);

  const consumeClick = useCallback(() => {
    if (!swallowClick.current) return false;
    swallowClick.current = false;
    return true;
  }, []);

  return {
    position,
    viewport,
    grabbed,
    dropKey,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    consumeClick,
  };
}
