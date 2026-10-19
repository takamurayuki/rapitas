'use client';
/**
 * RapiAvatar
 *
 * The resident Rapi+ avatar: a face, a tilted ring, and the "+" that gives
 * it its name. Drawn as SVG with SMIL animation.
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
  className?: string;
  style?: CSSProperties;
}

/* ───────── デザイントークン ───────── */

export const RAPI_AVATAR_TOKENS = {
  body: { light: '#6366F1', dark: '#818CF8' }, // indigo-500 / indigo-400
  trackOpacity: { light: 0.22, dark: 0.32 },
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

/* ───────── ジオメトリ（viewBox 0 0 120 120） ───────── */

const RING = { cx: 60, cy: 70, rx: 54, ry: 17, tilt: -18 } as const;
const BODY = { cx: 60, cy: 70, r: 37 } as const;
const EYES = { left: 48, right: 72, y: 72 } as const;
const PLUS = { x: 84, y: 22, rotate: 15, rotateError: 60, scale: 0.9 } as const;
/** The contact shadow under the body. Sits inside the viewBox's 120. */
const SHADOW = { cy: 113, rx: 27, ry: 6 } as const;
/** The specular highlight, upper-left, where the light is. */
const GLOSS = { cx: 46, cy: 54, rx: 15, ry: 9 } as const;

/**
 * How strong each depth layer is.
 *
 * White and black overlays rather than new hex colours, so the body keeps
 * its token colour in both themes and nothing here competes with the
 * palette the spec fixes.
 */
// `gloss` was 0.55 and read as a white patch rather than a sheen. Chosen
// by rendering 0.55 / 0.38 / 0.28 / 0.2 / 0.14 side by side on both
// themes and looking: 0.2 keeps the ball glossy without the spot, and
// 0.14 starts losing it.
const DEPTH = { lift: 0.3, terminator: 0.26, gloss: 0.2, cast: 0.3 } as const;

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
  className,
  style,
}: RapiAvatarProps) {
  const label = useStateLabel();
  const prefersReduced = usePrefersReducedMotion();
  const animate = !(reducedMotion ?? prefersReduced);
  const uid = useId().replace(/:/g, '');
  const clipId = `rapi-front-${uid}`;
  const shadeId = `rapi-shade-${uid}`;
  const glossId = `rapi-gloss-${uid}`;
  const castId = `rapi-cast-${uid}`;

  const body = RAPI_AVATAR_TOKENS.body[theme];
  const trackOpacity = showTrack ? RAPI_AVATAR_TOKENS.trackOpacity[theme] : 0;
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
  const eyeRx = state === 'waiting' ? 5 : 4.3;
  const eyeRy = state === 'waiting' ? 6.6 : 5.8;

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
      aria-label={`Rapi+ ${label(state)}`}
      className={className}
      style={{ display: 'block', overflow: 'visible', ...style }}
    >
      <defs>
        {/* 回転後の座標系で y>=70 が「環の手前側」 */}
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect x={-30} y={RING.cy} width={180} height={60} />
        </clipPath>

        {/* Depth, painted over the flat body rather than replacing it, so
            the token colour stays the colour. A circle reads as a sphere
            because of the shading across it; the cast shadow below only
            lifts it off the page. Light comes from the upper left, which
            is also where the "+" sits. */}
        <radialGradient id={shadeId} cx="0.34" cy="0.3" r="0.78">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity={DEPTH.lift} />
          <stop offset="0.52" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.82" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity={DEPTH.terminator} />
        </radialGradient>

        <radialGradient id={glossId} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity={DEPTH.gloss} />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>

        <radialGradient id={castId} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000000" stopOpacity={DEPTH.cast} />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 0. Cast shadow: furthest back, so the ring crosses over it too. */}
      <ellipse cx={BODY.cx} cy={SHADOW.cy} rx={SHADOW.rx} ry={SHADOW.ry} fill={`url(#${castId})`} />

      {/* 1. 環（奥側）: 本体の後ろに描く */}
      {ringLayer(false)}

      {/* 2. 本体 */}
      <circle cx={BODY.cx} cy={BODY.cy} r={BODY.r} fill={body} />
      {/* 2b. Shading over the body: the part that makes it a sphere. */}
      <circle cx={BODY.cx} cy={BODY.cy} r={BODY.r} fill={`url(#${shadeId})`} />
      <ellipse
        cx={GLOSS.cx}
        cy={GLOSS.cy}
        rx={GLOSS.rx}
        ry={GLOSS.ry}
        fill={`url(#${glossId})`}
        transform={`rotate(-28 ${GLOSS.cx} ${GLOSS.cy})`}
      />

      {/* 3. 目 */}
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
            <ellipse key={x} cx={x} cy={EYES.y} rx={eyeRx} ry={eyeRy} fill={RAPI_AVATAR_TOKENS.eye}>
              {/* Blinks wherever the eyes are dots, not only at rest. The
                  spec holds them still while running; a face that stops
                  blinking the moment it gets busy reads as frozen, so
                  this is a deliberate departure. The arc and line eyes
                  are different shapes and keep their own expression. */}
              {animate && (
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
          <g fill="none" stroke={RAPI_AVATAR_TOKENS.eye} strokeWidth={4} strokeLinecap="round">
            <path d="M42.5 72 L53.5 72" />
            <path d="M66.5 72 L77.5 72" />
          </g>
        )}
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
