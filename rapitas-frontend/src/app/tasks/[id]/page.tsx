import { Suspense } from 'react';
import TaskDetailClient from './TaskDetailClient';
import TaskDetailSkeleton from '@/components/ui/skeleton/TaskDetailSkeleton';

// NOTE: Required for static export — generates placeholder route params at build time.
export async function generateStaticParams() {
  // NOTE: Uses _placeholder as a build-time stand-in;
  // the build script redirects to actual IDs.
  return [{ id: '_placeholder' }];
}

export default function TaskDetailPage() {
  return (
    <Suspense fallback={<TaskDetailSkeleton />}>
      <TaskDetailClient />
    </Suspense>
  );
}
