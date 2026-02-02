"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TaskDetailClient from "../[id]/TaskDetailClient";

/**
 * Tauri用タスク詳細ページ
 * 動的ルーティングが使えないため、クエリパラメータでIDを受け取る
 * /tasks/detail?id=123 の形式でアクセス
 */
function TaskDetailContent() {
  const searchParams = useSearchParams();
  const taskId = searchParams.get("id");

  if (!taskId) {
    return (
      <div className="min-h-screen bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 flex items-center justify-center">
        <div className="text-center bg-white dark:bg-zinc-900 rounded-2xl p-8 shadow-xl border border-zinc-200 dark:border-zinc-800">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <span className="text-3xl">!</span>
          </div>
          <p className="text-red-600 dark:text-red-400 mb-4 font-medium">
            タスクIDが指定されていません
          </p>
        </div>
      </div>
    );
  }

  return <TaskDetailClient taskId={parseInt(taskId, 10)} />;
}

export default function TauriTaskDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-500 dark:text-zinc-400 text-sm">
              読み込み中...
            </p>
          </div>
        </div>
      }
    >
      <TaskDetailContent />
    </Suspense>
  );
}
