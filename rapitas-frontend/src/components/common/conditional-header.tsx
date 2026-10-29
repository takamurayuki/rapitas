'use client';

import { usePathname } from 'next/navigation';
import Header from '@/components/common/Header';
import { isAppShellHidden } from '@/utils/app-shell';

export default function ConditionalHeader() {
  const pathname = usePathname();

  // NOTE: the predicate moved to utils/app-shell — AppContent reserves the
  // side nav's width and has to agree with this, or the page keeps an empty
  // column where the nav is not (the sign-in form, 2026-10-29).
  if (isAppShellHidden(pathname)) {
    return null;
  }

  return <Header />;
}
