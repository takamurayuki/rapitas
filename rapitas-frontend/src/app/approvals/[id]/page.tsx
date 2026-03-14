import { Suspense } from 'react';
import ApprovalDetailClient from './ApprovalDetailClient';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// NOTE: Required for static export — generates placeholder route params at build time.
export async function generateStaticParams() {
  return [{ id: '_placeholder' }];
}

export default function ApprovalDetailPage() {
  return (
    <Suspense fallback={<LoadingSpinner variant="compact" />}>
      <ApprovalDetailClient />
    </Suspense>
  );
}
