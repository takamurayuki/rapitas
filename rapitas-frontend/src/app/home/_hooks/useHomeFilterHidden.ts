/**
 * useHomeFilterHidden
 *
 * Whether the home page's filter is folded to its one-line summary,
 * remembered in this browser. Not responsible for drawing either form.
 */
'use client';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'rapitas.home.filterHidden';

/**
 * Remembered hide/show state for the home filter.
 *
 * NOTE: Read after mount, not in the useState initialiser: the page is
 * server-rendered, and reading storage during render would make the first
 * client render differ from the server's.
 *
 * @returns Whether it is hidden, and a setter that also remembers it / 非表示か・切り替え
 */
export function useHomeFilterHidden(): [boolean, (hidden: boolean) => void] {
  const [hidden, setHiddenState] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setHiddenState(true);
    } catch {
      // Storage blocked (private window etc.): the filter just starts shown.
    }
  }, []);

  const setHidden = useCallback((next: boolean) => {
    setHiddenState(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, '1');
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Not remembered this time; the toggle itself still works.
    }
  }, []);

  return [hidden, setHidden];
}
