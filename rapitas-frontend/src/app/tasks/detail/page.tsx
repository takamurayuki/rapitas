'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import TaskDetailClient from '../[id]/TaskDetailClient';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useTranslations } from 'next-intl';

/**
 * Tauri用タスク詳細ページ
 * 動的ルーティングが使えないため、クエリパラメータでIDを受け取る
 * /tasks/detail?id=123 の形式でアクセス
 */
function TaskDetailContent() {
  const searchParams = useSearchParams();
  const t = useTranslations('task');
  const taskId = searchParams.get('id');

  if (!taskId) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-center bg-white dark:bg-indigo-dark-900 rounded-2xl p-8 shadow-xl border border-zinc-200 dark:border-zinc-800">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <span className="text-3xl">!</span>
          </div>
          <p className="text-red-600 dark:text-red-400 mb-4 font-medium">
            {t('taskIdNotSpecified')}
          </p>
        </div>
      </div>
    );
  }

  return <TaskDetailClient taskId={parseInt(taskId, 10)} />;
}

export default function TauriTaskDetailPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <TaskDetailContent />
    </Suspense>
  );
}
