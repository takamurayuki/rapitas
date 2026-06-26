/**
 * TaskDetailWrapper
 *
 * Reads the ?note=<id> search parameter and renders either the standard task
 * detail view or the split view (existing Note・AI editor + task detail).
 */
'use client';

import { useParams, useSearchParams } from 'next/navigation';
import TaskDetailClient from './TaskDetailClient';
import { TaskNoteSplitView } from './components/TaskNoteSplitView';

export default function TaskDetailWrapper() {
  const params = useParams();
  const searchParams = useSearchParams();

  const taskIdStr = params?.id as string | undefined;
  const taskId = taskIdStr && taskIdStr !== '_placeholder' ? Number(taskIdStr) : null;
  // Note IDs in the local store are strings (Date.now().toString())
  const noteId = searchParams?.get('note') ?? null;

  if (taskId && noteId) {
    return <TaskNoteSplitView taskId={taskId} noteId={noteId} />;
  }

  return <TaskDetailClient />;
}
