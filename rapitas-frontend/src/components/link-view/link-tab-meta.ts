/**
 * link-tab-meta
 *
 * What a tab says about itself — its heading and icon — and how a page
 * change reported by the webview folds into the url and title it stores.
 *
 * Pure on purpose. The merge rules are the part that is easy to get wrong,
 * and they are worth testing without a webview to drive them.
 */

/** The part of a tab these rules act on. */
export interface LinkTabMeta {
  url: string;
  /** The page's own title, once the webview has reported one. / ページタイトル */
  title?: string;
}

/**
 * A page change observed inside the webview.
 *
 * Both fields are optional because the two things that report one see
 * different halves: a navigation knows the URL, a title change knows the
 * title (and re-reads the URL, which may be the same one).
 */
export interface LinkPageChange {
  url?: string | null;
  title?: string | null;
}

/**
 * The host of a URL, or the whole string when it will not parse.
 *
 * @param url - A tab's address / タブのURL
 * @returns The host, or the input unchanged / ホスト名、解析不能ならそのまま
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A title with surrounding space removed, or undefined when there is none. */
function cleanTitle(title: string | null | undefined): string | undefined {
  const trimmed = title?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * What to show as a tab's heading.
 *
 * The page's title when it has reported one — a row of tabs all reading
 * `www.google.com` says nothing about which is which.
 *
 * @param tab - The tab being labelled / 対象のタブ
 * @returns The heading text / 見出し文字列
 */
export function tabLabel(tab: LinkTabMeta): string {
  return cleanTitle(tab.title) ?? hostOf(tab.url);
}

/**
 * The favicon for a URL's host.
 *
 * Derived rather than fetched: the icon service answers for any host, and
 * `POST /url-metadata` builds the same address — a round trip per
 * navigation would buy nothing. Returns an empty string for a string that
 * is not a URL, so the pane can draw its placeholder instead of an image
 * with a broken source.
 *
 * @param url - A tab's address / タブのURL
 * @returns An icon URL, or '' when there is no host / アイコンURL、無ければ空文字
 */
export function faviconFor(url: string): string {
  try {
    const { hostname } = new URL(url);
    if (!hostname) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
  } catch {
    return '';
  }
}

/**
 * Fold a reported page change into what a tab stores.
 *
 * The rule that matters: a title describes one page. When the URL moves,
 * any title that came with the move is kept and anything older is dropped,
 * so a tab never labels the page it has just left (#1078). When the URL is
 * unchanged — which is how the title arrives, one event after the
 * navigation — a newly reported title replaces the old one.
 *
 * @param current - What the tab holds now / 現在のタブ情報
 * @param change - What the webview reported / webview からの通知
 * @returns The tab's new url and title / 更新後のURLとタイトル
 */
export function nextTabMeta(current: LinkTabMeta, change: LinkPageChange): LinkTabMeta {
  const url = change.url?.trim() || current.url;
  const reported = cleanTitle(change.title);
  const title = url === current.url ? (reported ?? cleanTitle(current.title)) : reported;
  return title === undefined ? { url } : { url, title };
}
