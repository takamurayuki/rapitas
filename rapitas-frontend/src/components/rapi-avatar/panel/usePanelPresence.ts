/**
 * usePanelPresence
 *
 * How ラピ's panel arrives and goes away: the entrance replayed on every
 * open, and dismissal by Escape or by a press anywhere outside it.
 *
 * Lifted out of the panel so the panel stays about what it draws.
 */
import { useEffect, type RefObject } from 'react';

/**
 * @param bubble - The panel element / パネル要素
 * @param open - Whether it is showing / 表示中か
 * @param onClose - Called to dismiss it / 閉じる処理
 */
export function usePanelPresence(
  bubble: RefObject<HTMLDivElement | null>,
  open: boolean,
  onClose: () => void,
): void {
  /**
   * Replays the entrance on each open, without remounting anything.
   *
   * A CSS animation does not run again on an element that already carries
   * it, so keeping the panel mounted would otherwise have silently killed
   * the grow-out-of-her-tail that makes this read as ラピ speaking.
   *
   * `SpeechBubble`'s `speakKey` would replay it — by giving the bubble a new
   * element — and that is exactly the wrong tool here: a new element throws
   * away the typed text, the mode you are in and the request in flight, which is
   * the whole point of staying mounted. So the animation is restarted in
   * place: clear it, force a reflow to make the clear take effect, put it
   * back. The reflow read is load-bearing, not a leftover.
   */
  useEffect(() => {
    if (!open) return;
    const el = bubble.current;
    if (!el) return;
    const original = el.style.animation;
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = original;
  }, [bubble, open]);

  useEffect(() => {
    // Nothing to dismiss while it is hidden, and the outside-click listener
    // would otherwise call onClose on every click anywhere in the app.
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    // Looking away should end it. Hunting for an X is the wrong shape for
    // something that reads as speech, and Escape is keyboard-only.
    const onOutside = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target || bubble.current?.contains(target)) return;
      // ラピ herself is excluded, or her own toggle would fight this: closed
      // here on pointerdown, reopened by the click that follows.
      if (target instanceof Element && target.closest('[data-rapi-avatar="true"]')) return;
      onClose();
    };

    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside);
    };
  }, [bubble, onClose, open]);
}
