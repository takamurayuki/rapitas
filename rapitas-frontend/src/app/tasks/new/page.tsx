import { Suspense } from 'react';
import NewTaskClient from './NewTaskClient';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function NewTaskPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <NewTaskClient />
    </Suspense>
  );
}
