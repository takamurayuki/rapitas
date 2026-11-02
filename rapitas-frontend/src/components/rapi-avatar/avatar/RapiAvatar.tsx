'use client';
/**
 * RapiAvatar
 *
 * ラピ (Rapi), the character who lives in the app's corner: a face, a tilted
 * ring, and a "+" badge. Drawn as SVG with SMIL animation.
 *
 * The character is ラピ; the product is Rapi+. The badge is the difference
 * between the two, which is why it sits on the character's head rather than
 * anywhere else. The name itself is a catalogue string — see `useAvatarName`.
 *
 * Ported from the design's reference implementation. Every coordinate,
 * colour, duration and amplitude here is from that reference and from
 * `rapi-avatar-spec.md`, and is deliberately left alone — only the strings
 * were moved to next-intl, to match the rest of the app.
 *
 * Styles stay inline rather than becoming Tailwind classes: the values are
 * the design (a `12px 12px 4px 12px` radius, a specific shadow), and
 * keeping them written out is what makes them checkable against the spec.
 *
 * Not responsible for deciding WHICH state to show — see
 * `useRapiAvatarState`.
 */
import { useId, useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';

export type RapiAvatarState =
  | 'idle' // 待機
  | 'thinking' // 思考中
  | 'running' // 実行中
  | 'waiting' // 承認待ち
  | 'done' // 完了
  | 'error'; // エラー

export interface RapiAvatarProps {
  state: RapiAvatarState;
  /** running 時に環を回る彗星の数（1〜4）。rapitas の並列度に合わせる。既定 1 */
  agents?: number;
  /** 表示サイズ(px)。既定 88 */
  size?: number;
  theme?: 'light' | 'dark';
  /** idle 時の「+」の色。既定はインディゴ（本体と同色） */
  accent?: 'indigo' | 'amber';
  /** 環（軌道線）を表示するか。既定 true */
  showTrack?: boolean;
  /** 省略時は OS の prefers-reduced-motion に従う */
  reducedMotion?: boolean;
  /**
   * Whether ラピ is mid-startle: stretched tall, eyes tall with her, no blink.
   *
   * Held by the caller rather than timed here, so the drawing stays a pure
   * function of its props. / 驚いている最中か
   */
  startled?: boolean;
  /**
   * Bumped by the caller on every poke.
   *
   * SMIL will not replay an animation that is already on the page, so this
   * keys the group and a second poke replaces the element instead of being
   * swallowed. / 小突かれるたびに増える値
   */
  startleKey?: number;
  className?: string;
  style?: CSSProperties;
}

/* ───────── デザイントークン ───────── */

export const RAPI_AVATAR_TOKENS = {
  body: { light: '#6366F1', dark: '#818CF8' }, // indigo-500 / indigo-400
  trackOpacity: { light: 0.22, dark: 0.32 },
  /**
   * How dark her cast shadow is.
   *
   * Higher in dark mode and still barely visible there: the page behind her
   * is near-black, so there is almost nothing left to darken. A glow would
   * read on that background, but a glowing floor is not a shadow, and the
   * design language rules glows out (tell #3).
   */
  shadowOpacity: { light: 0.17, dark: 0.36 },
  comet: '#F59E0B', // amber-500
  eye: '#FFFFFF',
  plus: {
    thinking: '#94A3B8', // slate-400
    running: '#F59E0B', // amber-500（彗星と同色）
    waiting: '#8B5CF6', // violet-500
    done: '#10B981', // emerald-500
    error: '#EF4444', // red-500
  },
  cometLapDuration: '6s',
} as const;

/**
 * The spoken name of each state, from `rapiAvatar.<state>`.
 *
 * A hook rather than a constant map so the labels follow the UI locale the
 * way the rest of the app does.
 *
 * @returns A lookup from state to its label / 状態からラベルを引く関数
 */
export function useStateLabel(): (state: RapiAvatarState) => string {
  const t = useTranslations('rapiAvatar');
  return (state) => t(state);
}

/**
 * The character's name — ラピ in Japanese, Rapi in English.
 *
 * It is not the product name. The app is called Rapi+; the character that
 * lives in its corner is ラピ, and the "+" on its head is what turns the one
 * into the other. The avatar used to announce itself as "Rapi+ 実行中", which
 * read as though the application were the thing running.
 *
 * @returns The localised character name / ローカライズされたキャラクター名
 */
export function useAvatarName(): string {
  return useTranslations('rapiAvatar')('name');
}

/* ───────── ジオメトリ（viewBox 0 0 120 120） ───────── */

const RING = { cx: 60, cy: 70, rx: 54, ry: 17, tilt: -18 } as const;
const BODY = { cx: 60, cy: 70, r: 37 } as const;
const EYES = { left: 48, right: 72, y: 72 } as const;

/**
 * The shadow she casts, on the page behind her.
 *
 * Below her underside (the body is a circle at cy 70 with r 37, so 107) with
 * a gap: a shadow touching the object reads as the object resting on the
 * floor, and the gap is what says it is hovering. Narrower than she is and
 * very flat, for the same reason — a shadow as wide as its object reads as
 * the object itself.
 *
 * The first version left 4.5 units of gap, which measured 3px at the docked
 * size and read as almost touching. It is 14.5 now — a fifth of her
 * diameter. Moving it away alone would be wrong: something further above its
 * shadow casts a smaller, fainter one, so the ellipse shrank and the opacity
 * came down with the distance.
 *
 * It extends past the 120-unit viewBox, which is why the svg is
 * `overflow: visible`.
 */
const SHADOW = { cx: 60, cy: 127, rx: 23, ry: 5.5 } as const;

/**
 * How long the startle lasts.
 *
 * Short on purpose: it is a reaction, not a performance, and it sits in the
 * corner of every page. Exported so the dock's timer and the animation
 * cannot drift apart.
 */
export const STARTLE_DURATION_MS = 420;

/**
 * The stretch itself.
 *
 * Anchored at the bottom (`transform-origin: bottom`) rather than the centre:
 * scaling about the centre grows ラピ downwards too, through the front of her
 * own orbit, while from her base she rises out of it.
 *
 * Only the y axis moves, so this is a stretch and not a resize. Inline in the
 * SVG because the whole drawing is self-contained — there is no stylesheet
 * for this component to live in.
 */
const STARTLE_KEYFRAMES = `
@keyframes rapi-startle {
  0%   { transform: scaleY(1); }
  32%  { transform: scaleY(1.14); }
  68%  { transform: scaleY(0.97); }
  100% { transform: scaleY(1); }
}
@keyframes rapi-shadow {
  0%   { transform: scale(1); opacity: 1; }
  32%  { transform: scale(0.88); opacity: 0.72; }
  68%  { transform: scale(1.02); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes rapi-startle { from, to { transform: none; } }
  @keyframes rapi-shadow { from, to { transform: none; opacity: 1; } }
}
`;
const PLUS = { x: 84, y: 22, rotate: 15, rotateError: 60, scale: 0.9 } as const;

/* ───────── prefers-reduced-motion ───────── */

function subscribeReducedMotion(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function getReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}
function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
}

/* ───────── 本体 ───────── */

export function RapiAvatar({
  state,
  agents = 1,
  size = 88,
  theme = 'light',
  accent = 'indigo',
  showTrack = true,
  reducedMotion,
  startled = false,
  startleKey = 0,
  className,
  style,
}: RapiAvatarProps) {
  const label = useStateLabel();
  const name = useAvatarName();
  const prefersReduced = usePrefersReducedMotion();
  const animate = !(reducedMotion ?? prefersReduced);
  const uid = useId().replace(/:/g, '');
  const clipId = `rapi-front-${uid}`;
  const shadowId = `rapi-shadow-${uid}`;

  const body = RAPI_AVATAR_TOKENS.body[theme];
  const trackOpacity = showTrack ? RAPI_AVATAR_TOKENS.trackOpacity[theme] : 0;
  const shadowOpacity = RAPI_AVATAR_TOKENS.shadowOpacity[theme];
  const plusColor =
    state === 'idle'
      ? accent === 'amber'
        ? RAPI_AVATAR_TOKENS.comet
        : body
      : RAPI_AVATAR_TOKENS.plus[state];

  /* 彗星: running のときだけ。agents 個を等間隔に配置 */
  const cometCount = state === 'running' ? Math.max(1, Math.min(4, Math.round(agents))) : 0;
  const period = 100 / Math.max(cometCount, 1);
  const cometLayers = [
    { len: Math.min(34, period * 0.7), width: 1.4, opacity: 0.18 }, // 尾の先
    { len: Math.min(20, period * 0.42), width: 2.4, opacity: 0.32 },
    { len: Math.min(10, period * 0.2), width: 3.6, opacity: 0.6 },
    { len: 0.01, width: 6.4, opacity: 1 }, // 頭（丸い linecap で点になる）
  ];

  /* 目 */
  const eyeForm = state === 'done' ? 'arc' : state === 'error' ? 'line' : 'dot';
  const startle = startled && animate;

  // The eyes stretch with the body rather than simply growing: taller, barely
  // wider. Scaling both ways reads as "bigger"; taller reads as startled, and
  // it matches what the body is doing in the same frame. The blink stops too —
  // a face that blinks through a jolt reads as unbothered.
  const eyeRx = startle ? 4.6 : state === 'waiting' ? 5 : 4.3;
  const eyeRy = startle ? 8.4 : state === 'waiting' ? 6.6 : 5.8;

  /* 「+」の浮遊 */
  const bob =
    state === 'error'
      ? null
      : state === 'waiting'
        ? { values: '0 0;0 -4;0 0', dur: '1.2s' }
        : { values: '0 0;0 -2.2;0 0', dur: '3s' };

  const ringLayer = (front: boolean) => (
    <g transform={`rotate(${RING.tilt} ${RING.cx} ${RING.cy})`}>
      <g clipPath={front ? `url(#${clipId})` : undefined}>
        <ellipse
          cx={RING.cx}
          cy={RING.cy}
          rx={RING.rx}
          ry={RING.ry}
          fill="none"
          stroke={body}
          strokeWidth={1}
          opacity={trackOpacity}
        />
        {cometCount > 0 && (
          <g fill="none" stroke={RAPI_AVATAR_TOKENS.comet} strokeLinecap="round">
            {cometLayers.map((l, i) => (
              <ellipse
                key={i}
                cx={RING.cx}
                cy={RING.cy}
                rx={RING.rx}
                ry={RING.ry}
                pathLength={100}
                strokeWidth={l.width}
                opacity={l.opacity}
                strokeDasharray={`${l.len} ${period - l.len}`}
                strokeDashoffset={l.len}
              >
                {animate && (
                  <animate
                    attributeName="stroke-dashoffset"
                    values={`${l.len};${l.len - 100}`}
                    dur={RAPI_AVATAR_TOKENS.cometLapDuration}
                    repeatCount="indefinite"
                  />
                )}
              </ellipse>
            ))}
          </g>
        )}
      </g>
    </g>
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={`${name} ${label(state)}`}
      className={className}
      style={{ display: 'block', overflow: 'visible', ...style }}
    >
      <style>{STARTLE_KEYFRAMES}</style>

      <defs>
        {/* 回転後の座標系で y>=70 が「環の手前側」 */}
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect x={-30} y={RING.cy} width={180} height={60} />
        </clipPath>

        {/*
          Soft edges from a gradient rather than a blur filter: a filter on an
          element that sits over every page in the app is a per-frame cost for
          something that never changes shape, and the falloff is the only part
          that matters.
        */}
        <radialGradient id={shadowId}>
          <stop offset="0%" stopColor="#000000" stopOpacity={shadowOpacity} />
          <stop offset="55%" stopColor="#000000" stopOpacity={shadowOpacity * 0.55} />
          <stop offset="100%" stopColor="#000000" stopOpacity={0} />
        </radialGradient>
      </defs>

      {/*
        0. 影。
        First, so everything is painted over it, and outside the startle group
        so it stays on the ground while she rises out of it. When she does, it
        draws back a little — motion that tracks a real state change.
      */}
      <ellipse
        data-shadow="true"
        cx={SHADOW.cx}
        cy={SHADOW.cy}
        rx={SHADOW.rx}
        ry={SHADOW.ry}
        fill={`url(#${shadowId})`}
        style={
          startle
            ? {
                transformBox: 'fill-box',
                transformOrigin: 'center',
                animation: `rapi-shadow ${STARTLE_DURATION_MS}ms cubic-bezier(0.33, 1, 0.68, 1) 1`,
              }
            : undefined
        }
      />

      {/* 1. 環（奥側）: 本体の後ろに描く */}
      {ringLayer(false)}

      {/*
        2-3. 本体と目。
        The stretch wraps these two and not the ring: the orbit carries the
        comets, which report on real work and should not move because someone
        clicked. ラピ stretches inside her own orbit.

        CSS, not SMIL. A `<animateTransform>` with no `begin` starts at
        document time zero, so one inserted into a page that has been open for
        a few minutes is already over before it exists — it freezes at its end
        value and nothing happens. That is what shipped, and it never ran once.
        A CSS animation starts when the element does, and the key below means
        every poke inserts a new element.
      */}
      <g
        key={`startle-${startleKey}`}
        data-startle={startle ? 'true' : undefined}
        style={
          startle
            ? {
                transformBox: 'fill-box',
                transformOrigin: 'bottom center',
                animation: `rapi-startle ${STARTLE_DURATION_MS}ms cubic-bezier(0.33, 1, 0.68, 1) 1`,
              }
            : undefined
        }
      >
        <g>
          <g>
            <circle cx={BODY.cx} cy={BODY.cy} r={BODY.r} fill={body} />

            <g>
              {animate && state === 'thinking' && (
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values="0 0;2.5 -2.5;2.5 -2.5;0 0"
                  dur="3s"
                  repeatCount="indefinite"
                />
              )}
              {eyeForm === 'dot' &&
                [EYES.left, EYES.right].map((x) => (
                  <ellipse
                    key={x}
                    cx={x}
                    cy={EYES.y}
                    rx={eyeRx}
                    ry={eyeRy}
                    fill={RAPI_AVATAR_TOKENS.eye}
                  >
                    {/* Blinks wherever the eyes are dots, not only at rest. The
                  spec holds them still while running; a face that stops
                  blinking the moment it gets busy reads as frozen, so
                  this is a deliberate departure. The arc and line eyes
                  are different shapes and keep their own expression. */}
                    {animate && !startle && (
                      <animate
                        attributeName="ry"
                        values={`${eyeRy};${eyeRy};0.6;${eyeRy}`}
                        keyTimes="0;0.92;0.96;1"
                        dur="4.5s"
                        repeatCount="indefinite"
                      />
                    )}
                  </ellipse>
                ))}
              {eyeForm === 'arc' && (
                <g
                  fill="none"
                  stroke={RAPI_AVATAR_TOKENS.eye}
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M42.5 74 Q48 66.5 53.5 74" />
                  <path d="M66.5 74 Q72 66.5 77.5 74" />
                </g>
              )}
              {eyeForm === 'line' && (
                <g
                  fill="none"
                  stroke={RAPI_AVATAR_TOKENS.eye}
                  strokeWidth={4}
                  strokeLinecap="round"
                >
                  <path d="M42.5 72 L53.5 72" />
                  <path d="M66.5 72 L77.5 72" />
                </g>
              )}
            </g>
          </g>
        </g>
      </g>

      {/* 4. 環（手前側）: 本体の上に、手前半分だけ描く */}
      {ringLayer(true)}

      {/* 5. 右上の「+」: 回転はせず浮遊のみ */}
      <g
        transform={`translate(${PLUS.x} ${PLUS.y}) rotate(${state === 'error' ? PLUS.rotateError : PLUS.rotate}) scale(${PLUS.scale})`}
      >
        <g>
          {animate && bob && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values={bob.values}
              dur={bob.dur}
              repeatCount="indefinite"
            />
          )}
          <g>
            {animate && state === 'waiting' && (
              <animate
                attributeName="opacity"
                values="1;0.45;1"
                dur="1.4s"
                repeatCount="indefinite"
              />
            )}
            <rect x={-10} y={-3.6} width={20} height={7.2} rx={3.6} fill={plusColor} />
            <rect x={-3.6} y={-10} width={7.2} height={20} rx={3.6} fill={plusColor} />
          </g>
        </g>
      </g>
    </svg>
  );
}
