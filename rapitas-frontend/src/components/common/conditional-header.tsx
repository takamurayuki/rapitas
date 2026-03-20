'use client';

import { usePathname } from 'next/navigation';
import Header from '@/components/common/Header';

export default function ConditionalHeader() {
  const pathname = usePathname();

  // Hide header on /auth paths
  const shouldHideHeader = pathname.startsWith('/auth');

  if (shouldHideHeader) {
    return null;
  }

  return <Header />;
}
