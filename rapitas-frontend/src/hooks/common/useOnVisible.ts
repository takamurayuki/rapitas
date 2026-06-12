/**
 * useOnVisible
 *
 * Runs a callback whenever the page returns to the foreground
 * (document.visibilityState becomes 'visible'). Pairs with a
 * `if (document.hidden) return;` guard inside polling callbacks so pollers go
 * quiet while rapitas is in the background (the user is in another app) and
 * refresh immediately on return — keeping idle CPU/DB/network near zero.
 */

import { useEffect, useRef } from 'react';

/**
 * Invoke `onVisible` each time the tab/window becomes visible again.
 *
 * @param onVisible - Callback fired on the visible transition / 表示に戻ったとき実行
 */
export function useOnVisible(onVisible: () => void): void {
  const cbRef = useRef(onVisible);
  cbRef.current = onVisible;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handler = () => {
      if (!document.hidden) cbRef.current();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);
}
