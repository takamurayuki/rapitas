'use client';
/**
 * RapiHeld
 *
 * What ラピ looks like while she is being carried: pinched by two fingertips
 * at the very top of her head, the skin there pulled up into a little peak,
 * her body hanging and stretched beneath it and swinging behind the hand.
 * Put down, she lands with a small squash.
 *
 * Wraps the drawing rather than changing it. `RapiAvatar` is a pure function
 * of her state and is already at its size limit; everything here is a
 * transform around it plus an overlay on top, so the face, the ring and the
 * comets keep reporting on real work while she is held.
 *
 * Reduced motion keeps the fingertips — they are what says she is held —
 * and drops the stretch, the swing and the landing.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { RAPI_AVATAR_TOKENS } from '../RapiAvatar';

/**
 * Where she hangs from, as a share of her box.
 *
 * The pinch point in the 120-unit drawing is (60, 19): above the sphere's
 * top at y 33, where the pulled-up peak ends. Swinging about any other point
 * makes the fingers slide across her as she swings.
 */
const PINCH_ORIGIN = '50% 16%';

const HELD_STYLES = `
@keyframes rapi-pinch-in {
  0%   { transform: scaleY(0.2); opacity: 0; }
  60%  { transform: scaleY(1.15); opacity: 1; }
  100% { transform: scaleY(1); opacity: 1; }
}
@keyframes rapi-fingers-in {
  0%   { opacity: 0; transform: translateY(-6px); }
  100% { opacity: 1; transform: none; }
}
@keyframes rapi-land {
  0%   { transform: scale(1.08, 0.88); }
  45%  { transform: scale(0.96, 1.05); }
  75%  { transform: scale(1.02, 0.98); }
  100% { transform: none; }
}
[data-rapi-held="true"] [data-shadow="true"] { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  [data-rapi-hang], [data-rapi-land] { transform: none !important; animation: none !important; transition: none !important; }
  [data-rapi-pinch] * { animation: none !important; }
}
`;

const FINGER = {
  light: { fill: '#F4F4F5', stroke: '#A1A1AA', nail: '#FFFFFF' },
  dark: { fill: '#52525B', stroke: '#A1A1AA', nail: '#71717A' },
} as const;

interface Props {
  children: ReactNode;
  /** Whether she is being held now. / つままれているか */
  grabbed: boolean;
  /** Swing from the pinch, degrees. / 揺れ角 */
  sway: number;
  /** Bumped on each put-down. / 着地のたびに増える値 */
  dropKey: number;
  theme: 'light' | 'dark';
}

/**
 * One fingertip, its pad pressed against the peak.
 *
 * Drawn pointing straight down with its rounded end at (0, 0), then turned
 * about that end, so the angle never moves the point of contact.
 */
function Fingertip({ x, angle, theme }: { x: number; angle: number; theme: 'light' | 'dark' }) {
  const c = FINGER[theme];
  return (
    <g transform={`translate(${x} 22) rotate(${angle})`}>
      <rect
        x={-7.5}
        y={-34}
        width={15}
        height={34}
        rx={7.5}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.2}
      />
      <rect x={-4} y={-11} width={8} height={7} rx={3} fill={c.nail} opacity={0.9} />
    </g>
  );
}

/**
 * The overlay drawn on top of her while held: the pinched peak and the two
 * fingertips holding it.
 */
function Pinch({ theme }: { theme: 'light' | 'dark' }) {
  const body = RAPI_AVATAR_TOKENS.body[theme];
  return (
    <svg
      data-rapi-pinch="true"
      aria-hidden="true"
      viewBox="0 0 120 120"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {/* The skin under the fingers, pulled up out of the sphere. Its base
          sits inside the circle so the two read as one surface. */}
      <path
        d="M49 39 Q55 32 57.5 21 Q60 15 62.5 21 Q65 32 71 39 Z"
        fill={body}
        style={{
          transformBox: 'fill-box',
          transformOrigin: '50% 100%',
          animation: 'rapi-pinch-in 180ms cubic-bezier(0.34, 1.4, 0.64, 1) 1 both',
        }}
      />
      <g style={{ animation: 'rapi-fingers-in 140ms ease-out 1 both' }}>
        <Fingertip x={54.5} angle={-20} theme={theme} />
        <Fingertip x={65.5} angle={20} theme={theme} />
      </g>
    </svg>
  );
}

/**
 * @param props - The drawing to hold, and how it is being held
 */
export function RapiHeld({ children, grabbed, sway, dropKey, theme }: Props) {
  const land = useRef<HTMLDivElement>(null);

  // Replays the landing in place on each put-down. Remounting would replay
  // it too, but it would also restart every SMIL animation in the drawing,
  // so she would blink and her comets would jump each time she is let go.
  useEffect(() => {
    const el = land.current;
    if (!el || dropKey === 0) return;
    el.style.animation = 'none';
    void el.offsetHeight; // the read is what makes the reset take effect
    el.style.animation = 'rapi-land 380ms cubic-bezier(0.33, 1, 0.68, 1) 1';
  }, [dropKey]);

  return (
    <div data-rapi-held={grabbed ? 'true' : undefined} style={{ position: 'relative' }}>
      <style>{HELD_STYLES}</style>
      {/* Two wrappers because the two motions pivot on different points: the
          swing hangs from the pinch, the landing squashes onto her base. */}
      <div
        data-rapi-hang="true"
        style={{
          position: 'relative',
          transformOrigin: PINCH_ORIGIN,
          transform: grabbed ? `rotate(${sway}deg) scale(0.93, 1.1)` : 'none',
          transition: 'transform 160ms cubic-bezier(0.34, 1.3, 0.64, 1)',
        }}
      >
        <div data-rapi-land="true" ref={land} style={{ transformOrigin: '50% 100%' }}>
          {children}
        </div>
        {grabbed && <Pinch theme={theme} />}
      </div>
    </div>
  );
}
