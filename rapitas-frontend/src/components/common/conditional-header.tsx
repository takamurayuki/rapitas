'use client';

import { usePathname } from 'next/navigation';
import Header from '@/components/common/Header';

export default function ConditionalHeader() {
  const pathname = usePathname();

  // Hide header on /auth paths and in the frameless popup windows
  // (quick capture, notification toast).
  const shouldHideHeader =
    pathname.startsWith('/auth') ||
    pathname.startsWith('/quick-capture') ||
    pathname.startsWith('/notification-toast');

  if (shouldHideHeader) {
    return null;
  }

  return <Header />;
}
