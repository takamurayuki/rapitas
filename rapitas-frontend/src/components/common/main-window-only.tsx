'use client';

/**
 * MainWindowOnly
 *
 * Renders children only in the MAIN app window. The Next.js root layout also
 * wraps the Tauri popup windows (notification toast, quick capture), and
 * mounting the app's global chrome there — keyboard shortcuts, command bar,
 * banners, schedulers — lets a stray click or hotkey navigate the tiny popup
 * into a miniature copy of the app (observed with the toast window).
 */
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Route prefixes served inside dedicated popup windows. */
const POPUP_PREFIXES = ['/notification-toast', '/quick-capture'];

/**
 * Gate global chrome to the main window.
 *
 * @param props - Children to render outside popup windows. / ポップアップ以外で描画する子要素。
 */
export function MainWindowOnly({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (POPUP_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  return <>{children}</>;
}
