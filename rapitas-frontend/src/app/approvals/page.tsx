import { Suspense } from 'react';
import ApprovalsClient from './_components/ApprovalsClient';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ApprovalsClient />
    </Suspense>
  );
}
