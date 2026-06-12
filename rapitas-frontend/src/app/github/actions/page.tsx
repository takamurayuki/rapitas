import { Suspense } from 'react';
import ActionsClient from './ActionsClient';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function GitHubActionsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ActionsClient />
    </Suspense>
  );
}
