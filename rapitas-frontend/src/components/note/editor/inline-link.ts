/**
 * inline-link
 *
 * Plain hyperlinks inside note text — blue, underlined, the words still the
 * words. The toolbar's link button makes a *card* instead (a chip with a
 * favicon and the page's title); this is the other kind, the one you get by
 * pasting a URL over something you selected.
 *
 * Both are `<a>` elements in the same document, so telling them apart is
 * part of the job and lives here. Not responsible for the paste itself or
 * for the hover popup — see `useInlineLinks`.
 */

/** Longest URL worth treating as one; past this a browser gives up too. */
const MAX_URL_LENGTH = 2048;

/** A single http(s) URL and nothing else. */
const LONE_URL_RE = /^https?:\/\/\S+$/i;

/** The blue a link is drawn in. Matches the link card's text colour. */
const LINK_COLOR = '#3b82f6';

/**
 * The URL in some pasted text, when the text is just a URL.
 *
 * A sentence that mentions a link is still a sentence, so only text that is
 * a lone http(s) URL counts. Other schemes are refused for the same reason
 * the in-app pane refuses them: a `javascript:` or `file:` anchor sitting in
 * a note is an escalation sink, not a link.
 *
 * @param text - What was pasted / 貼り付けられた文字列
 * @returns The URL, or null when it is not one / URL、該当しなければ null
 */
export function urlFromPastedText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  return LONE_URL_RE.test(trimmed) ? trimmed : null;
}

/**
 * Whether an anchor is one of the toolbar's link cards.
 *
 * Mirrors `normalizeLinkCards`: the data attribute when it survived, and
 * otherwise the shape, because DOMPurify strips `data-*` on load.
 *
 * @param anchor - The anchor to classify / 判定する要素
 * @returns True for a link card / リンクカードなら true
 */
export function isLinkCard(anchor: HTMLAnchorElement): boolean {
  if (anchor.dataset.rapitasLinkCard === '1') return true;
  return anchor.style.display === 'inline-flex' && Boolean(anchor.style.background);
}

/**
 * Whether an anchor is an inline link — a real link that is not a card.
 *
 * @param anchor - The anchor to classify / 判定する要素
 * @returns True for an inline link / インラインリンクなら true
 */
export function isInlineLink(anchor: HTMLAnchorElement): boolean {
  if (!anchor.getAttribute('href')) return false;
  return !isLinkCard(anchor);
}

/**
 * Give an anchor the inline-link look.
 *
 * Inline styles rather than a class: note HTML is saved as-is and rendered
 * in other places, so the appearance has to travel with the content.
 *
 * @param anchor - The anchor to style / 対象の要素
 */
export function styleInlineLink(anchor: HTMLAnchorElement): void {
  anchor.style.color = LINK_COLOR;
  anchor.style.textDecoration = 'underline';
  anchor.style.cursor = 'pointer';
  anchor.rel = 'noopener noreferrer';
}

/**
 * Build an inline link.
 *
 * No `target`: DOMPurify strips it on load anyway, and the click is routed
 * by the editor rather than by the browser.
 *
 * @param url - Where it points / リンク先
 * @param text - The words to show / 表示する文字列
 * @returns The anchor / 生成した要素
 */
export function createInlineLink(url: string, text: string): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = url;
  if (text) anchor.textContent = text;
  styleInlineLink(anchor);
  return anchor;
}

/**
 * Remove a link, keeping everything inside it.
 *
 * The words are the valuable part; the link is an attribute of them. Child
 * nodes are moved rather than re-created so formatting inside the link —
 * bold, a colour — survives.
 *
 * @param anchor - The link to remove / 解除するリンク
 */
export function unwrapInlineLink(anchor: HTMLAnchorElement): void {
  const parent = anchor.parentNode;
  if (!parent) return;
  while (anchor.firstChild) parent.insertBefore(anchor.firstChild, anchor);
  parent.removeChild(anchor);
  // Leaves adjacent text nodes split; normalising keeps the caret from
  // landing in a seam the user cannot see.
  if (parent instanceof HTMLElement || parent instanceof DocumentFragment) parent.normalize();
}

/**
 * The inline link a range sits inside, if any.
 *
 * @param range - The current selection / 現在の選択範囲
 * @returns The enclosing inline link, or null / 内包するリンク、無ければ null
 */
export function enclosingInlineLink(range: Range): HTMLAnchorElement | null {
  const node = range.commonAncestorContainer;
  const el = node instanceof HTMLElement ? node : node.parentElement;
  const anchor = el?.closest('a');
  return anchor && isInlineLink(anchor) ? anchor : null;
}

/**
 * Turn what a range covers into a link.
 *
 * A range already inside a link re-points that one rather than nesting a
 * second inside it — pasting a new URL over a link means "go here instead",
 * not "two links".
 *
 * Whitespace alone is refused: a link you cannot see or click is worse than
 * the paste not having worked.
 *
 * @param range - What to link / リンクにする範囲
 * @param url - Where it should point / リンク先
 * @returns The link, or null when there was nothing to link / 生成したリンク、無ければ null
 */
export function linkRange(range: Range, url: string): HTMLAnchorElement | null {
  const existing = enclosingInlineLink(range);
  if (existing) {
    existing.href = url;
    styleInlineLink(existing);
    return existing;
  }
  if (range.collapsed) return null;

  const anchor = createInlineLink(url, '');
  anchor.appendChild(range.extractContents());
  if (!anchor.textContent?.trim()) {
    // Put back what was taken; the caller's selection was not linkable.
    range.insertNode(anchor);
    unwrapInlineLink(anchor);
    return null;
  }
  range.insertNode(anchor);
  return anchor;
}
