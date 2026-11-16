'use client';
/**
 * SpeechBubble
 *
 * The chrome that makes something ラピ says look like ラピ saying it: a tail
 * aimed at her, a radius that tightens where the tail meets the body, and an
 * entrance that grows out of the tail rather than fading in on the spot.
 *
 * One implementation on purpose. Two things in the corner speak — the status
 * line and the panel she opens — and a bubble drawn twice would drift in
 * radius, tail size and timing until they stopped looking like the same
 * character.
 *
 * Not responsible for placement: the caller positions the bubble and says
 * where ラピ is relative to it.
 */
import type { CSSProperties, ReactNode, Ref } from 'react';

/** How long the bubble takes to arrive. Within the 300ms overlay budget. */
export const SPEAK_DURATION_MS = 220;

/**
 * The bubble's surface, in one place for both of the things that speak.
 *
 * Zinc, matching the rest of the app: the status bubble was on gray-800/700
 * and the panel on zinc, which is exactly the drift a shared bubble exists
 * to stop. Written as literals because the tail is drawn with border
 * triangles, and a triangle's colour cannot come from a Tailwind class on
 * the parent.
 */
export const BUBBLE_COLORS = {
  light: { background: '#FFFFFF', borderColor: '#E4E4E7' },
  dark: { background: '#18181B', borderColor: '#3F3F46' },
} as const;

/** Half the tail's width at its base. */
const TAIL_HALF = 9;
/** How far the tail reaches toward ラピ. */
const TAIL_LENGTH = 11;

/**
 * Where ラピ is, so the tail can point at her.
 *
 * `bottom` is the panel's case — it sits above her. `right` is the status
 * line's case — it sits beside her. `top` and `left` are the same two once
 * she has been carried somewhere they would leave the window: the panel
 * below her, the status line on her right.
 */
export type TailSide = 'bottom' | 'top' | 'right' | 'left';

export interface SpeechBubbleProps {
  children: ReactNode;
  /** Which edge the tail leaves from. / 尻尾が出る辺 */
  tailSide: TailSide;
  /**
   * Distance from the far corner of that edge to the tail's point, in px.
   *
   * For a bottom or top tail, measured from the bubble's right edge; for a
   * right or left tail, from its bottom edge. It is the caller's job to aim this at ラピ,
   * since only the caller knows where both of them sit.
   */
  tailOffsetPx: number;
  /** Background, as a CSS color. / 背景色 */
  background: string;
  /** Border, as a CSS color. / 枠線色 */
  borderColor: string;
  /** Re-mounting with a new value replays the entrance. / 入場を再生するキー */
  speakKey?: number;
  /** The bubble element, for callers that need to ask what was clicked. */
  innerRef?: Ref<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
  role?: string;
  'aria-label'?: string;
  'aria-live'?: 'off' | 'polite' | 'assertive';
}

/**
 * The entrance.
 *
 * Grows from the tail, which is what makes it read as coming out of ラピ
 * rather than appearing over the page — the transform-origin is set per
 * instance from the tail's own position.
 *
 * Reduced motion gets the bubble with no movement at all. The override is a
 * second `@keyframes` of the same name inside the media query: redefining it
 * leaves the animation running and the element still, which keeps the
 * fallback in one place instead of branching the component.
 */
const SPEAK_KEYFRAMES = `
@keyframes rapi-speak {
  0%   { opacity: 0; transform: scale(0.9); }
  70%  { opacity: 1; transform: scale(1.012); }
  100% { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes rapi-speak { from, to { opacity: 1; transform: none; } }
}
`;

/**
 * Where the bubble grows from: the tail, not the centre or a corner.
 *
 * `calc()`, and specifically NOT the `right 34px bottom 0` edge-offset form.
 * That form belongs to `background-position`; `transform-origin` has no
 * four-value syntax, so a browser drops the whole declaration and falls back
 * to the centre. It shipped that way and the bubble grew from its middle —
 * measured in Chromium, `transform-origin` computed to `160px 111px`, dead
 * centre of a 320x222 panel. jsdom reads it back as an empty string either
 * way and cannot tell the two apart.
 *
 * So the value is built here and tested here, and that it lands is measured
 * in a real browser: `calc(100% - 34px) 100%` computes to `286px 222px`,
 * which is the bottom edge, 34px in from the right.
 *
 * @param side - Which edge the tail leaves from / 尻尾が出る辺
 * @param offsetPx - Distance from the far corner of that edge / 角からの距離
 * @returns A CSS transform-origin / CSS の transform-origin
 */
export function speakOrigin(side: TailSide, offsetPx: number): string {
  switch (side) {
    case 'bottom':
      return `calc(100% - ${offsetPx}px) 100%`;
    case 'top':
      return `calc(100% - ${offsetPx}px) 0%`;
    case 'right':
      return `100% calc(100% - ${offsetPx}px)`;
    case 'left':
      return `0% calc(100% - ${offsetPx}px)`;
  }
}

/**
 * The bubble's radius, tight at the corner the tail leaves from.
 *
 * Four equal corners with a tail stuck on reads as a card with a
 * decoration. Bottom and right tails both leave from the bottom-right
 * corner, which is why they share one value.
 *
 * @param side - Which edge the tail leaves from / 尻尾が出る辺
 * @returns A CSS border-radius / CSS の border-radius
 */
export function bubbleRadius(side: TailSide): string {
  switch (side) {
    case 'top':
      return '14px 5px 14px 14px';
    case 'left':
      return '14px 14px 14px 5px';
    default:
      return '14px 14px 5px 14px';
  }
}

/**
 * The tail, as two triangles.
 *
 * The one behind is the border colour and the one in front is the fill,
 * offset by a pixel, which leaves the border showing along the tail's two
 * sides. A single triangle cannot have a 1px edge on two sides and none on
 * the third.
 */
function Tail({
  side,
  offsetPx,
  background,
  borderColor,
}: {
  side: TailSide;
  offsetPx: number;
  background: string;
  borderColor: string;
}) {
  const base: CSSProperties = { position: 'absolute', width: 0, height: 0 };
  const sides = `${TAIL_HALF}px solid transparent`;
  const vertical = side === 'bottom' || side === 'top';

  // The coloured border is the one against the bubble's edge; the two across
  // it are transparent, which is what makes the triangle point away.
  const pointing: Record<TailSide, keyof CSSProperties> = {
    bottom: 'borderTop',
    top: 'borderBottom',
    right: 'borderLeft',
    left: 'borderRight',
  };
  const layer = (color: string, inset: number): CSSProperties => ({
    ...base,
    ...(vertical
      ? { right: offsetPx - TAIL_HALF, borderLeft: sides, borderRight: sides }
      : { bottom: offsetPx - TAIL_HALF, borderTop: sides, borderBottom: sides }),
    [side]: -TAIL_LENGTH + inset,
    [pointing[side]]: `${TAIL_LENGTH}px solid ${color}`,
  });

  return (
    <>
      <span data-bubble-tail="border" style={layer(borderColor, 0)} />
      <span data-bubble-tail="fill" style={layer(background, 1.5)} />
    </>
  );
}

/**
 * Wrap content in ラピ's speech bubble.
 *
 * @param props - The content, where ラピ is, and the bubble's colours
 * @returns The bubble / 吹き出し
 */
export function SpeechBubble({
  children,
  tailSide,
  tailOffsetPx,
  background,
  borderColor,
  speakKey = 0,
  innerRef,
  className,
  style,
  role,
  'aria-label': ariaLabel,
  'aria-live': ariaLive,
}: SpeechBubbleProps) {
  const radius = bubbleRadius(tailSide);

  const origin = speakOrigin(tailSide, tailOffsetPx);

  return (
    <div
      key={`speak-${speakKey}`}
      ref={innerRef}
      role={role}
      aria-label={ariaLabel}
      aria-live={ariaLive}
      data-speech-bubble="true"
      className={className}
      style={{
        position: style?.position ?? 'relative',
        background,
        border: `1px solid ${borderColor}`,
        borderRadius: radius,
        transformOrigin: origin,
        animation: `rapi-speak ${SPEAK_DURATION_MS}ms cubic-bezier(0.34, 1.3, 0.64, 1) 1`,
        ...style,
      }}
    >
      <style>{SPEAK_KEYFRAMES}</style>
      {children}
      <Tail
        side={tailSide}
        offsetPx={tailOffsetPx}
        background={background}
        borderColor={borderColor}
      />
    </div>
  );
}
