'use client';
/**
 * RapiAvatarDock
 *
 * Puts the avatar in the bottom-right corner and gives it a speech bubble.
 *
 * Positions and speaks; the drawing is `RapiAvatar`. Everything except the
 * avatar and the bubble lets clicks through, because this floats over every
 * page in the app.
 *
 * The values here — the corner offsets, the bubble's asymmetric radius, the
 * shadow — come from `rapi-avatar-spec.md` and are left written out rather
 * than translated to utility classes, so they stay checkable against it.
 */
import {
  RapiAvatar,
  useStateLabel,
  type RapiAvatarProps,
  type RapiAvatarState,
} from './RapiAvatar';

/**
 * How big the avatar is drawn in the corner, overriding the drawing's own
 * 88px default.
 *
 * 88 made the sphere 54px, against a header whose largest button is 40px and
 * whose icon buttons are 36px — it read as an intruder rather than as part of
 * the app. At 68 the sphere is 42px, level with those controls, and the orbit
 * and badge still read at a glance (measured; below ~60 they stop).
 */
const DOCK_AVATAR_SIZE = 68;

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
}

export function RapiAvatarDock({ message, onClick, ...avatar }: RapiAvatarDockProps) {
  const label = useStateLabel();
  const dark = avatar.theme === 'dark';
  const showBubble = avatar.state !== 'idle' && !!message;

  return (
    <div
      style={{
        position: 'fixed',
        right: 24,
        bottom: 20,
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 4,
        pointerEvents: 'none', // 下のコンテンツの操作を邪魔しない
      }}
    >
      <div aria-live="polite" style={{ marginBottom: 24 }}>
        {showBubble && (
          <div
            style={{
              pointerEvents: 'auto',
              maxWidth: 280,
              background: dark ? '#1F2937' : '#FFFFFF',
              border: `1px solid ${dark ? '#374151' : '#E5E7EB'}`,
              borderRadius: '12px 12px 4px 12px',
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
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClick}
        aria-label={`Rapi+ ${label(avatar.state)}${message ? `: ${message}` : ''}`}
        style={{
          pointerEvents: 'auto',
          background: 'transparent',
          border: 0,
          padding: 0,
          cursor: onClick ? 'pointer' : 'default',
        }}
      >
        <RapiAvatar size={DOCK_AVATAR_SIZE} {...avatar} />
      </button>
    </div>
  );
}
