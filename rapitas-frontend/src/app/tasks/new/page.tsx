import { Suspense } from 'react';
import NewTaskClient from './NewTaskClient';
import { NewTaskSkeleton } from '@/components/ui/LoadingSpinner';

export default function NewTaskPage() {
  return (
    <Suspense fallback={<NewTaskSkeleton />}>
      <NewTaskClient />
    </Suspense>
  );
}
