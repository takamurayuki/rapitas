'use client';
/**
 * RapiAvatarDock
 *
 * Puts the avatar where she was last left — the bottom-right corner until
 * she is carried somewhere else — and gives her a speech bubble.
 *
 * Positions and speaks; the drawing is `RapiAvatar`, the gesture that moves
 * her is `useRapiDrag` (owned by the host, since the panel follows her too)
 * and how she looks while held is `RapiHeld`. Everything except the
 * avatar and the bubble lets clicks through, because this floats over every
 * page in the app.
 *
 * The values here — the corner offsets, the bubble's asymmetric radius, the
 * shadow — come from `rapi-avatar-spec.md` and are left written out rather
 * than translated to utility classes, so they stay checkable against it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RapiAvatar,
  STARTLE_DURATION_MS,
  useAvatarName,
  useStateLabel,
  type RapiAvatarProps,
  type RapiAvatarState,
} from './RapiAvatar';
import { RAPI_AVATAR_Z } from '@/lib/pane-layering';
import { BUBBLE_COLORS, SpeechBubble } from './SpeechBubble';
import {
  AVATAR_BOX_PX,
  DEFAULT_POSITION,
  RapiHeld,
  isOnLeft,
  type AvatarPosition,
  type RapiDrag,
  type Viewport,
} from './drag';

/**
 * How big the avatar is drawn in the corner, overriding the drawing's own
 * 88px default.
 *
 * 88 made the sphere 54px, against a header whose largest button is 40px and
 * whose icon buttons are 36px — it read as an intruder rather than as part of
 * the app. At 68 the sphere is 42px, level with those controls, and the orbit
 * and badge still read at a glance (measured; below ~60 they stop).
 */
const DOCK_AVATAR_SIZE = AVATAR_BOX_PX;

/**
 * How far up the bubble's right edge the tail sits.
 *
 * Measured at 1400x960: the tip lands 9px above her centre and 6px inside her
 * left edge — so it touches her, in her upper third. That is deliberate.
 * Aiming at the geometric centre of a 68px circle points the tail at her
 * middle; speech comes from a face, and hers is up there.
 */
const BUBBLE_TAIL_OFFSET_PX = 18;

const TAG_COLOR: Record<Exclude<RapiAvatarState, 'idle'>, string> = {
  thinking: '#6B7280',
  running: '#B45309',
  waiting: '#6D28D9',
  done: '#047857',
  error: '#DC2626',
};

export interface RapiAvatarDockProps extends Omit<RapiAvatarProps, 'className' | 'style'> {
  /** 吹き出しの本文。idle のときは表示しない */
  message?: string;
  /** アバタークリック時（詳細パネルを開く等） */
  onClick?: () => void;
  /**
   * Makes her draggable. Without it she stays in the corner, which is what
   * every caller but the app shell wants. / ドラッグ移動（省略時は固定）
   */
  drag?: Pick<
    RapiDrag,
    'position' | 'viewport' | 'grabbed' | 'dropKey' | 'handlers' | 'consumeClick'
  >;
}

/** The fallback viewport only decides which side the bubble is on. */
const WIDE: Viewport = { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY };

export function RapiAvatarDock({ message, onClick, drag, ...avatar }: RapiAvatarDockProps) {
  const label = useStateLabel();
  const name = useAvatarName();

  // ラピ jumps a little when poked. The timing lives here rather than in the
  // drawing so the drawing stays a pure function of its props.
  const [startled, setStartled] = useState(false);
  const [startleKey, setStartleKey] = useState(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    [],
  );

  // Replays the bubble's entrance whenever what she says changes, so a new
  // line arrives rather than the text changing in place. Keyed on the text
  // itself: the state can stay the same while the sentence does not.
  const [speakKey, setSpeakKey] = useState(0);
  const lastSpoken = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (message === lastSpoken.current) return;
    lastSpoken.current = message;
    if (message) setSpeakKey((n) => n + 1);
  }, [message]);

  const consumeClick = drag?.consumeClick;
  const poke = useCallback(() => {
    // The click that ends a drag is a put-down, not a poke: she should not
    // jump, and the panel should not open or close as she lands.
    if (consumeClick?.()) return;
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    setStartleKey((n) => n + 1);
    setStartled(true);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      setStartled(false);
    }, STARTLE_DURATION_MS);
    onClick?.();
  }, [onClick, consumeClick]);
  const dark = avatar.theme === 'dark';
  const showBubble = avatar.state !== 'idle' && !!message;

  const position: AvatarPosition = drag?.position ?? DEFAULT_POSITION;
  const viewport = drag?.viewport ?? WIDE;
  // On the left half the bubble moves to her right, or it would leave the
  // window. Anchored by `left` then, so the bubble appearing does not shove
  // her sideways — the container grows away from her either way.
  const onLeft = !!drag && isOnLeft(position, viewport);
  const anchor = onLeft
    ? { left: viewport.width - position.right - AVATAR_BOX_PX }
    : { right: position.right };

  return (
    <div
      style={{
        position: 'fixed',
        ...anchor,
        bottom: position.bottom,
        zIndex: RAPI_AVATAR_Z,
        display: 'flex',
        flexDirection: onLeft ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: 4,
        pointerEvents: 'none', // 下のコンテンツの操作を邪魔しない
      }}
    >
      <div aria-live="polite" style={{ marginBottom: 24 }}>
        {showBubble && (
          <SpeechBubble
            tailSide={onLeft ? 'left' : 'right'}
            tailOffsetPx={BUBBLE_TAIL_OFFSET_PX}
            {...BUBBLE_COLORS[dark ? 'dark' : 'light']}
            // A new thing to say should look like a new thing being said,
            // not like the old text swapped out underneath.
            speakKey={speakKey}
            style={{
              pointerEvents: 'auto',
              maxWidth: 280,
              padding: '12px 16px',
              boxShadow: '0 6px 20px rgba(17, 24, 39, 0.10)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: TAG_COLOR[avatar.state as Exclude<RapiAvatarState, 'idle'>],
              }}
            >
              {label(avatar.state)}
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.6, color: dark ? '#F3F4F6' : '#1F2937' }}>
              {message}
            </span>
          </SpeechBubble>
        )}
      </div>
      <button
        type="button"
        onClick={poke}
        {...drag?.handlers}
        data-rapi-grabbed={drag?.grabbed ? 'true' : undefined}
        // Marked so the panel's close-on-outside-click can skip her: closing
        // on pointerdown here would be undone by her own toggle on the click.
        data-rapi-avatar="true"
        aria-label={`${name} ${label(avatar.state)}${message ? `: ${message}` : ''}`}
        style={{
          pointerEvents: 'auto',
          background: 'transparent',
          border: 0,
          padding: 0,
          cursor: drag ? (drag.grabbed ? 'grabbing' : 'grab') : onClick ? 'pointer' : 'default',
          // A touch drag would otherwise scroll the page underneath her.
          touchAction: drag ? 'none' : undefined,
        }}
      >
        <RapiHeld grabbed={!!drag?.grabbed} dropKey={drag?.dropKey ?? 0}>
          <RapiAvatar
            size={DOCK_AVATAR_SIZE}
            startled={startled}
            startleKey={startleKey}
            {...avatar}
          />
        </RapiHeld>
      </button>
    </div>
  );
}
