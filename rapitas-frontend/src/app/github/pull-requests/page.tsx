import { Suspense } from 'react';
import PullRequestsClient from './PullRequestsClient';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function PullRequestsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <PullRequestsClient />
    </Suspense>
  );
}
