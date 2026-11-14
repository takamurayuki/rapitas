/**
 * rapi-float-protocol
 *
 * What the main window and ラピ's own window say to each other on the
 * desktop (#1535), in one place so neither side can drift from the other.
 *
 * Events go through Tauri's event bus; the window's visibility and its
 * click-through are the Rust side's (`rapi_float.rs`). Not responsible for
 * sending anything — see `RapiFloatBridge` and `RapiFloatPage`.
 */

/** Her window's label, and the route it loads. Mirrors `RAPI_FLOAT_LABEL`. */
export const RAPI_FLOAT_LABEL = 'rapi-float';

/** The route her window loads. */
export const RAPI_FLOAT_ROUTE = '/rapi-float';

/** main → her: where the main window is and how it looks. */
export const LOCATION_EVENT = 'rapi-float://location';

/** her → main: send the location again (her page has just loaded). */
export const HELLO_EVENT = 'rapi-float://hello';

/** her → main: open an in-app link in the main window. */
export const NAVIGATE_EVENT = 'rapi-float://navigate';

/**
 * → her: shown or hidden (Rust, `VISIBILITY_EVENT` in `rapi_float.rs`), or the
 * main window has just loaded (the bridge). Either may mean a new frontend.
 */
export const VISIBILITY_EVENT = 'rapi-float://visibility-changed';

/** The main window's state, as her window needs it. */
export interface MainLocation {
  pathname: string;
  panelParam: string | null;
  dark: boolean;
  /**
   * Whether she may be seen: false on the pages without the app shell and
   * while a dialog or menu of the main window is open.
   */
  shown: boolean;
}

/** A rectangle she is drawn in, in CSS pixels. Mirrors `HitRect` in Rust. */
export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Whether this document runs inside the Tauri desktop app.
 *
 * @returns True on the desktop / デスクトップアプリ内なら true
 */
export function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * The in-app path an anchor points at, or null when it leaves the app.
 *
 * Her links open tasks (`/tasks/42?showHeader=true`); followed in her own
 * window they would turn the transparent overlay into a copy of the app.
 *
 * @param href - The anchor's `href` attribute / リンク先
 * @returns The path to open in the main window, or null / メイン画面で開くパス
 */
export function inAppPath(href: string | null): string | null {
  if (!href || !href.startsWith('/') || href.startsWith('//')) return null;
  return href;
}

/**
 * Where she is drawn, from the elements that make her up.
 *
 * Empty boxes are left out: the panel stays mounted with `display: none`
 * while closed, and a 0x0 rectangle at the origin would still be a place
 * the Rust side tests the pointer against.
 *
 * @param elements - Her button, her bubbles and any open list / 構成要素
 * @param pad - Extra margin so a shadow's edge still counts / 余白(px)
 * @returns The rectangles, rounded to whole pixels / 矩形一覧
 */
export function hitRectsOf(elements: Iterable<Element>, pad = 0): HitRect[] {
  const rects: HitRect[] = [];
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    rects.push({
      x: Math.floor(r.left - pad),
      y: Math.floor(r.top - pad),
      width: Math.ceil(r.width + pad * 2),
      height: Math.ceil(r.height + pad * 2),
    });
  }
  return rects;
}
