'use client';
/**
 * RapiHeld
 *
 * The one thing ラピ does about being carried: when she is put down, she
 * lands with a small squash and settles.
 *
 * While held she is drawn exactly as she is at rest. A pinched-at-the-top
 * pose with fingertips, a stretch and a swing shipped first and was taken
 * out on request (2026-11-14); the landing was kept.
 *
 * Wraps the drawing rather than changing it, so the face, the ring and the
 * comets keep reporting on real work throughout. Reduced motion drops the
 * landing.
 */
import { useEffect, useRef, type ReactNode } from 'react';

const LAND_STYLES = `
@keyframes rapi-land {
  0%   { transform: scale(1.08, 0.88); }
  45%  { transform: scale(0.96, 1.05); }
  75%  { transform: scale(1.02, 0.98); }
  100% { transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  [data-rapi-land] { animation: none !important; }
}
`;

interface Props {
  children: ReactNode;
  /** Whether she is being held now. / つままれているか */
  grabbed: boolean;
  /** Bumped on each put-down. / 着地のたびに増える値 */
  dropKey: number;
}

/**
 * @param props - The drawing, and whether / when she was put down
 */
export function RapiHeld({ children, grabbed, dropKey }: Props) {
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
    <div data-rapi-held={grabbed ? 'true' : undefined}>
      <style>{LAND_STYLES}</style>
      {/* Squashes onto her base, so she lands rather than shrinks. */}
      <div data-rapi-land="true" ref={land} style={{ transformOrigin: '50% 100%' }}>
        {children}
      </div>
    </div>
  );
}
