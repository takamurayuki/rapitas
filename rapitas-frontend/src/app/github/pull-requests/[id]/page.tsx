import { Suspense } from 'react';
import PullRequestDetailClient from './PullRequestDetailClient';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// NOTE: Required for static export — generates placeholder route params at build time.
export async function generateStaticParams() {
  return [{ id: '_placeholder' }];
}

export default function PullRequestDetailPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <PullRequestDetailClient />
    </Suspense>
  );
}
