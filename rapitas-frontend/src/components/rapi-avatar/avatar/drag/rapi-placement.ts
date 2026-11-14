/**
 * rapi-placement
 *
 * The geometry of a ラピ who can be carried: where she may be put, and where
 * her panel and her status bubble go relative to wherever she is.
 *
 * Pure functions of a position and the viewport, so every edge case can be
 * checked without a browser. Not responsible for pointer handling or
 * persistence — see `useRapiDrag`.
 *
 * A position is held as her distance from the viewport's bottom-right
 * corner, not from the top-left. The default is that corner, so a window
 * resized larger keeps her where she was relative to it, which is where the
 * eye goes looking for her.
 */

/** Her distance from the bottom-right corner of the viewport, in px. */
export interface AvatarPosition {
  right: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** The docked drawing's box. Mirrors `DOCK_AVATAR_SIZE` in the dock. */
export const AVATAR_BOX_PX = 68;

/** The corner she has always lived in. */
export const DEFAULT_POSITION: AvatarPosition = { right: 24, bottom: 20 };

/** How close to a window edge she may be put. */
const EDGE_PX = 8;
/** How close to a window edge the panel may reach. */
const PANEL_EDGE_PX = 16;
/**
 * The gap between her and the panel, which the 11px tail crosses.
 *
 * 12 above her keeps `bottom: 100` for the docked case, the number the fixed
 * corner used and that the spacing was measured against.
 */
const PANEL_GAP_PX = 12;
/** Below this much room above her, the panel opens beneath her instead. */
const MIN_PANEL_ROOM_PX = 360;
/** The tallest the panel gets, as a share of the window. */
const MAX_PANEL_SHARE = 0.7;
/** How far the tail may sit from a corner of the panel. */
const TAIL_INSET_PX = 20;
/** Her widest swing while held, in degrees. */
const MAX_SWAY_DEG = 18;
/** Degrees of swing per px/ms of horizontal speed. */
const SWAY_PER_SPEED = 14;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Keep her fully inside the window.
 *
 * @param pos - Where she was asked to go / 置こうとした位置
 * @param vp - The window / ビューポート
 * @returns The nearest position that is on screen / 画面内に収めた位置
 */
export function clampPosition(pos: AvatarPosition, vp: Viewport): AvatarPosition {
  return {
    right: clamp(pos.right, EDGE_PX, vp.width - AVATAR_BOX_PX - EDGE_PX),
    bottom: clamp(pos.bottom, EDGE_PX, vp.height - AVATAR_BOX_PX - EDGE_PX),
  };
}

/**
 * Where she is after the pointer has moved by (dx, dy) since the grab.
 *
 * @param start - Where she was when grabbed / つまんだ時点の位置
 * @param dx - Pointer movement to the right, px / 右方向の移動量
 * @param dy - Pointer movement downward, px / 下方向の移動量
 * @param vp - The window / ビューポート
 * @returns The new, on-screen position / 移動後の位置
 */
export function moveBy(
  start: AvatarPosition,
  dx: number,
  dy: number,
  vp: Viewport,
): AvatarPosition {
  return clampPosition({ right: start.right - dx, bottom: start.bottom - dy }, vp);
}

/**
 * Whether her centre is on the left half of the window.
 *
 * Her status bubble sits on whichever side has room; in the corner that is
 * her left, and once she is carried left of centre it has to swap.
 *
 * @param pos - Where she is / 現在位置
 * @param vp - The window / ビューポート
 * @returns True on the left half / 左半分にいれば true
 */
export function isOnLeft(pos: AvatarPosition, vp: Viewport): boolean {
  return vp.width - pos.right - AVATAR_BOX_PX / 2 < vp.width / 2;
}

/** Where the panel goes and how its tail points back at her. */
export interface PanelPlacement {
  /** Above her (tail on the bottom edge) or below her (tail on top). */
  side: 'above' | 'below';
  /** Distance of the panel's right edge from the window's. */
  right: number;
  /** Set when `side` is `above`. */
  bottom?: number;
  /** Set when `side` is `below`. */
  top?: number;
  /** The width it is drawn at, already narrowed to the window. */
  width: number;
  /** Tail position, measured from the panel's right edge. */
  tailOffsetPx: number;
  /** The tallest it may be without leaving the window. */
  maxHeightPx: number;
}

/**
 * Place the panel next to her, on screen, with its tail aimed at her.
 *
 * Above her by default, as it always was. Below her only when she has been
 * carried high enough that there is not room for a usable panel above and
 * there is more room below. Horizontally it lines up with her outer edge —
 * her right edge in the corner, her left edge once she is on the left — and
 * is then pushed back inside the window, so the tail is computed last, from
 * where the panel actually ended up.
 *
 * @param pos - Where she is / 現在位置
 * @param vp - The window / ビューポート
 * @param preferredWidth - The panel's width on a wide window / 本来の幅
 * @returns Where to draw it / パネルの配置
 */
export function placePanel(
  pos: AvatarPosition,
  vp: Viewport,
  preferredWidth: number,
): PanelPlacement {
  const width = Math.min(preferredWidth, vp.width - PANEL_EDGE_PX * 2);
  const avatarLeft = vp.width - pos.right - AVATAR_BOX_PX;
  const wantedRight = isOnLeft(pos, vp) ? vp.width - avatarLeft - width : pos.right;
  const right = clamp(wantedRight, PANEL_EDGE_PX, vp.width - width - PANEL_EDGE_PX);

  const centreFromRight = pos.right + AVATAR_BOX_PX / 2;
  const tailOffsetPx = clamp(centreFromRight - right, TAIL_INSET_PX, width - TAIL_INSET_PX);

  const aboveBottom = pos.bottom + AVATAR_BOX_PX + PANEL_GAP_PX;
  const roomAbove = vp.height - aboveBottom - PANEL_EDGE_PX;
  const belowTop = vp.height - pos.bottom + PANEL_GAP_PX;
  const roomBelow = vp.height - belowTop - PANEL_EDGE_PX;
  const cap = vp.height * MAX_PANEL_SHARE;

  if (roomAbove >= MIN_PANEL_ROOM_PX || roomAbove >= roomBelow) {
    return {
      side: 'above',
      right,
      bottom: aboveBottom,
      width,
      tailOffsetPx,
      maxHeightPx: Math.min(cap, roomAbove),
    };
  }
  return {
    side: 'below',
    right,
    top: belowTop,
    width,
    tailOffsetPx,
    maxHeightPx: Math.min(cap, roomBelow),
  };
}

/**
 * How far she swings from the pinch, given how fast she is being moved.
 *
 * She hangs from the top of her head, so her body lags behind the hand:
 * carried to the right, her bottom trails to the left, which is a clockwise
 * (positive) CSS rotation about the pinch.
 *
 * @param speedX - Horizontal pointer speed, px/ms (right is positive) / 横方向の速度
 * @returns Rotation in degrees / 回転角(度)
 */
export function swayFor(speedX: number): number {
  const deg = speedX * SWAY_PER_SPEED;
  return Math.max(-MAX_SWAY_DEG, Math.min(MAX_SWAY_DEG, deg)) + 0;
}
