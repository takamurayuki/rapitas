'use client';
// OfflineIndicatorLoader
import dynamic from 'next/dynamic';

const OfflineIndicator = dynamic(
  () => import('@/components/common/OfflineIndicator').then((m) => m.OfflineIndicator),
  { ssr: false },
);

export default function OfflineIndicatorLoader() {
  return <OfflineIndicator />;
}
