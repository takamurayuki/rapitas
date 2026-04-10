/**
 * OfflineIndicatorLoader
 *
 * Client Component wrapper that lazy-loads OfflineIndicator with ssr:false.
 * layout.tsx is a Server Component where `next/dynamic({ ssr: false })` is
 * not allowed, so we need this intermediary.
 */
'use client';
import dynamic from 'next/dynamic';

const OfflineIndicator = dynamic(
  () =>
    import('@/components/common/OfflineIndicator').then(
      (m) => m.OfflineIndicator,
    ),
  { ssr: false },
);

export default function OfflineIndicatorLoader() {
  return <OfflineIndicator />;
}
