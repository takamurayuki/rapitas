'use client';

import { usePathname } from 'next/navigation';
import Header from '@/components/common/Header';

export default function ConditionalHeader() {
  const pathname = usePathname();

  // Hide header on /auth paths and in the frameless quick-capture popup window
  const shouldHideHeader = pathname.startsWith('/auth') || pathname.startsWith('/quick-capture');

  if (shouldHideHeader) {
    return null;
  }

  return <Header />;
}
