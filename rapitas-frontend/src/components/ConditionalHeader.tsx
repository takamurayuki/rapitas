'use client';

import { usePathname } from 'next/navigation';
import Header from '@/components/Header';

export default function ConditionalHeader() {
  const pathname = usePathname();

  // /auth で始まるパスではヘッダーを非表示
  const shouldHideHeader = pathname.startsWith('/auth');

  if (shouldHideHeader) {
    return null;
  }

  return <Header />;
}
