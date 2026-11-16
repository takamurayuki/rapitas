/**
 * useChatFollow
 *
 * When a chat log should keep its newest line in view, and when to offer a
 * jump back to it. New lines pull the log to the bottom only right after
 * the user sent something, or when they were already reading at the bottom;
 * someone scrolled up to read is left where they are and gets the ▽ button
 * instead. Mirrors the mobile ラピ screen (rapi_jump_to_latest.dart).
 *
 * Not responsible for drawing the button — see `JumpToLatestButton`.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Distance from the bottom (px) at which the jump button appears. */
export const JUMP_THRESHOLD_PX = 200;

/** Distance from the bottom (px) still counted as "reading the newest line". */
export const FOLLOW_THRESHOLD_PX = 80;

interface Options {
  /** The scrolling log. / スクロールする一覧 */
  ref: RefObject<HTMLElement | null>;
  /**
   * Changes whenever a line is added or the typing row appears or goes —
   * e.g. `${messages.length}:${sending}`. Growth inside a card does not
   * change it, so a card filling in never moves the reader. / 行の増減の印
   */
  contentKey: string | number;
  /** True when the newest line is one the user just sent. / 自分が送った直後か */
  sentByUser: boolean;
  /**
   * Keep the log at the bottom while the newest line grows after it was
   * added — a text reply whose Markdown renderer loads on demand — as long
   * as the reader has not scrolled away. Leave off for cards, which fill in
   * below a heading the reader should keep in view. / 最新行の伸びに追従する
   */
  followGrowth?: boolean;
}

export interface ChatFollow {
  /** Whether the ▽ button should be shown. / ジャンプボタンを出すか */
  showJump: boolean;
  /** Smoothly scrolls to the newest line. / 最新の行へ滑らかに移る */
  jumpToLatest: () => void;
  /** Attach to the log's `onScroll`. / 一覧の onScroll に渡す */
  onScroll: () => void;
}

function distanceToEnd(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

/**
 * @param options - The log, what marks a new line, and whether the user sent it
 * @returns Whether to show the jump button, the jump, and the scroll handler / ボタン表示・ジャンプ・スクロール処理
 */
export function useChatFollow({
  ref,
  contentKey,
  sentByUser,
  followGrowth = false,
}: Options): ChatFollow {
  const [showJump, setShowJump] = useState(false);
  // NOTE: updated by the reader's scrolling only, never by content growing.
  // Measured after a new line has rendered, everyone would look "away from
  // the bottom" by that line's height; what matters is where they were.
  const atEnd = useRef(true);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setShowJump(distanceToEnd(el) >= JUMP_THRESHOLD_PX);
  }, [ref]);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    atEnd.current = distanceToEnd(el) <= FOLLOW_THRESHOLD_PX;
    measure();
  }, [measure, ref]);

  // Layout effect so the jump lands before paint and the new line never
  // flashes in at the old position.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (sentByUser || atEnd.current) {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      atEnd.current = true;
    }
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per new line only (contentKey); sentByUser is read for that line
  }, [contentKey]);

  // A line that grows after it was added (a card's answer arriving, a
  // reply's renderer loading) moves the bottom without a scroll event.
  // Re-measure so the button can appear; a growing text reply also keeps a
  // reader who was at the bottom there.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (followGrowth && atEnd.current)
        el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      measure();
    });
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [contentKey, followGrowth, measure, ref]);

  const jumpToLatest = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    atEnd.current = true;
  }, [ref]);

  return { showJump, jumpToLatest, onScroll };
}
