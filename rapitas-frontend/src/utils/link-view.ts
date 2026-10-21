/**
 * link-view
 *
 * Where a link from a note or a task description opens, and the thin wrappers
 * over the Tauri commands that drive the docked webview.
 *
 * Not responsible for laying the pane out — `useLinkView` owns the rectangle
 * and calls `setLinkViewBounds` when it changes.
 */
import { isTauri } from './tauri';
import { createLogger } from '@/lib/logger';

const logger = createLogger('link-view');

/** localStorage key for how links from notes / task descriptions open. */
export const LINK_OPEN_MODE_KEY = 'rapitas.linkOpenMode';

/** Where a link opens. `external` is the long-standing behaviour. */
export type LinkOpenMode = 'external' | 'internal';

/** A rectangle in CSS pixels, relative to the window's top-left corner. */
export interface LinkViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The user's link-open mode.
 *
 * Defaults to `external` so an upgrade changes nothing until the setting is
 * touched, and falls back to it outside Tauri, where there is no webview to
 * dock. A blocked or empty localStorage reads as the default rather than
 * throwing — this runs on every link click.
 *
 * @returns The configured mode / 設定されたモード
 */
export function getLinkOpenMode(): LinkOpenMode {
  if (!isTauri()) return 'external';
  try {
    return localStorage.getItem(LINK_OPEN_MODE_KEY) === 'internal' ? 'internal' : 'external';
  } catch {
    return 'external';
  }
}

/**
 * Persist the link-open mode.
 *
 * @param mode - Where links should open from now on / 今後リンクを開く場所
 */
export function setLinkOpenMode(mode: LinkOpenMode): void {
  try {
    if (mode === 'internal') localStorage.setItem(LINK_OPEN_MODE_KEY, 'internal');
    else localStorage.removeItem(LINK_OPEN_MODE_KEY);
  } catch {
    logger.warn('Could not persist the link open mode');
  }
}

/**
 * Whether a URL may be shown in the docked webview.
 *
 * Mirrors the Rust side's check rather than trusting it: a link that cannot
 * open internally must fall back to the external handler, and finding that
 * out here avoids a round trip that would only come back as an error.
 *
 * @param url - The link's href / リンクのURL
 * @returns True when the pane can show it / ペインで表示できるなら true
 */
export function canShowInLinkView(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Run a link-view command, logging rather than throwing at the call site. */
async function invokeLinkView(command: string, args?: Record<string, unknown>): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke(command, args);
    return true;
  } catch (error) {
    logger.error(`${command} failed:`, error);
    return false;
  }
}

/**
 * Show `url` in the docked webview at `bounds`, creating it on first use.
 *
 * @param tabId - Which tab's webview / 対象タブ
 * @param url - The link to show / 表示するリンク
 * @param bounds - Where the pane sits / ペインの矩形
 * @returns False when the command failed and the caller should fall back / 失敗時 false
 */
export function openLinkView(tabId: string, url: string, bounds: LinkViewBounds): Promise<boolean> {
  return invokeLinkView('open_link_webview', { tabId, url, bounds });
}

/**
 * Move the docked webview to match the pane.
 *
 * @param bounds - The pane's new rectangle / ペインの新しい矩形
 */
export function setLinkViewBounds(tabId: string, bounds: LinkViewBounds): Promise<boolean> {
  return invokeLinkView('set_link_webview_bounds', { tabId, bounds });
}

/**
 * Show or hide the docked webview without losing its page.
 *
 * The pane hides it whenever something that must draw on top is open: a child
 * webview is an OS surface and paints above all HTML regardless of z-index.
 *
 * @param visible - Whether the webview should be on screen / 表示するか
 */
export function setLinkViewVisible(tabId: string, visible: boolean): Promise<boolean> {
  return invokeLinkView('set_link_webview_visible', { tabId, visible });
}

/** Close the docked webview. */
export function closeLinkView(tabId: string): Promise<boolean> {
  return invokeLinkView('close_link_webview', { tabId });
}

/**
 * Move the docked webview's history, or reload it.
 *
 * @param action - `back`, `forward` or `reload` / 履歴操作
 */
export function linkViewHistory(
  tabId: string,
  action: 'back' | 'forward' | 'reload',
): Promise<boolean> {
  return invokeLinkView('link_webview_history', { tabId, action });
}

/**
 * A page change the docked webview reported about itself.
 *
 * The two things that report one see different halves: a navigation knows
 * the URL it is heading to, a title change knows the title and re-reads the
 * URL — which is also how a page that moves through the History API is
 * noticed at all, since that fires no navigation.
 */
export interface LinkViewPageChange {
  /** Which tab's webview moved. / 対象タブ */
  tabId: string;
  url?: string | null;
  title?: string | null;
}

/** The Tauri event the Rust side emits for both halves. */
const PAGE_CHANGED_EVENT = 'link-view://page-changed';

/**
 * Listen for the docked webviews reporting where they went.
 *
 * @param handler - Called for every report, from any tab / 通知のハンドラ
 * @returns Stop listening / リスナー解除関数
 */
export async function onLinkViewPageChanged(
  handler: (change: LinkViewPageChange) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<LinkViewPageChange>(PAGE_CHANGED_EVENT, (event) => handler(event.payload));
  } catch (error) {
    logger.error('Could not listen for link view navigation:', error);
    return () => {};
  }
}
