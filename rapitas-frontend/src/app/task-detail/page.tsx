'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import TaskDetailClient from '@/app/tasks/[id]/TaskDetailClient';
import TaskDetailSkeleton from '@/components/ui/skeleton/TaskDetailSkeleton';

/**
 * Tauri用の静的タスク詳細ページ
 * 動的ルーティングが使えないTauri環境で、クエリパラメータからタスクIDを取得する
 * 使用例: /task-detail?id=123
 */
function TaskDetailContent() {
  const searchParams = useSearchParams();
  const taskIdParam = searchParams.get('id');
  const taskId = taskIdParam ? parseInt(taskIdParam, 10) : null;

  if (!taskId || isNaN(taskId)) {
    return (
      <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] flex items-center justify-center scrollbar-thin">
        <div className="text-center bg-white dark:bg-indigo-dark-900 rounded-2xl p-8 shadow-xl border border-zinc-200 dark:border-zinc-800">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <span className="text-3xl">!</span>
          </div>
          <p className="text-red-600 dark:text-red-400 mb-4 font-medium">
            タスクIDが指定されていません
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            URLパラメータで ?id=123 の形式でタスクIDを指定してください
          </p>
        </div>
      </div>
    );
  }

  return <TaskDetailClient taskId={taskId} />;
}

export default function TaskDetailPage() {
  return (
    <Suspense fallback={<TaskDetailSkeleton />}>
      <TaskDetailContent />
    </Suspense>
  );
}
