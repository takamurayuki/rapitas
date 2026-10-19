'use client';
/**
 * useInlineLinks
 *
 * The behaviour around plain links in note text: pasting a URL to make one,
 * Ctrl+clicking to follow one, and the hover popup that opens, edits or
 * removes one.
 *
 * Why a popup rather than a plain click: this is an editor, so a click
 * inside a link has to put the caret there — otherwise the words can never
 * be corrected. Google Docs and Notion resolve it the same way, and the
 * popup is then the natural home for "remove the link", which has nowhere
 * else obvious to live.
 *
 * Owns no content: it edits the DOM the editor already holds and reports
 * the change so the note is marked dirty.
 */
import { useCallback, useRef, useState } from 'react';
import { openExternalLink } from '@/utils/external-links';
import {
  enclosingInlineLink,
  isInlineLink,
  linkRange,
  styleInlineLink,
  unwrapInlineLink,
  urlFromPastedText,
} from './inline-link';

/** Where the popup sits and what it is about. */
export interface InlineLinkPopupState {
  /** The link being pointed at. / 対象のリンク */
  anchor: HTMLAnchorElement;
  url: string;
  /** Viewport coordinates of the link's top-left. / 表示位置 */
  x: number;
  y: number;
}

/** What the editor needs to wire this up. */
export interface UseInlineLinksReturn {
  popup: InlineLinkPopupState | null;
  onPaste: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  /** Ctrl/Cmd+click follows a link; a plain click is left to the caret. */
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseOver: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
  /**
   * Show the panel when the CARET is inside a link, so it is reachable
   * without a pointer — hover alone would leave keyboard users with no way
   * to remove a link at all. / キャレットがリンク内にある時も表示
   */
  onCaretMoved: () => void;
  /** Keep the popup up while the pointer is on it. / ポップアップ上では維持 */
  holdPopup: () => void;
  releasePopup: () => void;
  openPopupLink: () => void;
  removePopupLink: () => void;
  retargetPopupLink: (url: string) => void;
  dismissPopup: () => void;
}

/** Grace period before the popup goes, so the pointer can reach it. */
const POPUP_LEAVE_DELAY_MS = 180;

/**
 * Wire inline links into a contentEditable editor.
 *
 * @param contentRef - The editable element / 編集領域
 * @param onContentChange - Called whenever the DOM is edited / 変更通知
 * @returns Handlers for the editor and the popup's state / ハンドラと表示状態
 */
export function useInlineLinks(
  contentRef: React.RefObject<HTMLDivElement | null>,
  onContentChange: () => void,
): UseInlineLinksReturn {
  const [popup, setPopup] = useState<InlineLinkPopupState | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelLeave = useCallback(() => {
    if (leaveTimer.current !== null) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }, []);

  const dismissPopup = useCallback(() => {
    cancelLeave();
    setPopup(null);
  }, [cancelLeave]);

  /** The inline link under an event's target, if there is one. */
  const linkAt = useCallback(
    (target: EventTarget | null): HTMLAnchorElement | null => {
      if (!(target instanceof HTMLElement)) return null;
      if (!contentRef.current?.contains(target)) return null;
      const anchor = target.closest('a');
      return anchor && isInlineLink(anchor) ? anchor : null;
    },
    [contentRef],
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const url = urlFromPastedText(event.clipboardData.getData('text/plain'));
      if (!url) return;

      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range || !contentRef.current?.contains(range.commonAncestorContainer)) return;

      event.preventDefault();
      // With a selection, the words stay and gain a link. With none, the
      // URL itself becomes the words — what a browser does, and better
      // than dropping in text nobody can click.
      const anchor = range.collapsed
        ? insertUrlAsLink(range, url)
        : (linkRange(range, url) ?? insertUrlAsLink(range, url));

      // Put the caret after the link so typing continues outside it.
      if (anchor && selection) {
        const after = document.createRange();
        after.setStartAfter(anchor);
        after.collapse(true);
        selection.removeAllRanges();
        selection.addRange(after);
      }
      onContentChange();
    },
    [contentRef, onContentChange],
  );

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = linkAt(event.target);
      if (!anchor) return;
      // A plain click belongs to the caret — this is an editor. Ctrl/Cmd is
      // the long-standing "follow it anyway" gesture.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      dismissPopup();
      openExternalLink(anchor.href);
    },
    [linkAt, dismissPopup],
  );

  const onMouseOver = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = linkAt(event.target);
      if (!anchor) return;
      cancelLeave();
      const rect = anchor.getBoundingClientRect();
      setPopup({ anchor, url: anchor.href, x: rect.left, y: rect.top });
    },
    [linkAt, cancelLeave],
  );

  const onCaretMoved = useCallback(() => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !contentRef.current?.contains(range.commonAncestorContainer)) return;
    const anchor = enclosingInlineLink(range);
    if (!anchor) {
      // The caret has left; the panel goes with it. Hovering re-opens it
      // through `onMouseOver`, and moving onto the panel itself fires
      // nothing here, so this cannot snatch it away mid-click.
      setPopup(null);
      return;
    }
    cancelLeave();
    const rect = anchor.getBoundingClientRect();
    setPopup({ anchor, url: anchor.href, x: rect.left, y: rect.top });
  }, [contentRef, cancelLeave]);

  const onMouseLeave = useCallback(() => {
    cancelLeave();
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null;
      setPopup(null);
    }, POPUP_LEAVE_DELAY_MS);
  }, [cancelLeave]);

  const openPopupLink = useCallback(() => {
    if (!popup) return;
    const { url } = popup;
    dismissPopup();
    openExternalLink(url);
  }, [popup, dismissPopup]);

  const removePopupLink = useCallback(() => {
    if (!popup) return;
    unwrapInlineLink(popup.anchor);
    dismissPopup();
    onContentChange();
  }, [popup, dismissPopup, onContentChange]);

  const retargetPopupLink = useCallback(
    (url: string) => {
      if (!popup) return;
      const next = urlFromPastedText(url);
      if (!next) return;
      popup.anchor.href = next;
      styleInlineLink(popup.anchor);
      dismissPopup();
      onContentChange();
    },
    [popup, dismissPopup, onContentChange],
  );

  return {
    popup,
    onPaste,
    onClick,
    onMouseOver,
    onMouseLeave,
    onCaretMoved,
    holdPopup: cancelLeave,
    releasePopup: onMouseLeave,
    openPopupLink,
    removePopupLink,
    retargetPopupLink,
    dismissPopup,
  };
}

/** Drop the URL in as a link showing the URL itself. */
function insertUrlAsLink(range: Range, url: string): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.textContent = url;
  styleInlineLink(anchor);
  range.deleteContents();
  range.insertNode(anchor);
  return anchor;
}
