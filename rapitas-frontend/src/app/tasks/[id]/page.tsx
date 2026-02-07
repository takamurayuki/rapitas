import { Suspense } from "react";
import TaskDetailClient from "./TaskDetailClient";

// 静的エクスポート用 - プレースホルダーIDを生成
export async function generateStaticParams() {
  // プレースホルダーとして_placeholder を使用
  // ビルドスクリプトで実際のIDにリダイレクトされる
  return [{ id: "_placeholder" }];
}

export default function TaskDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-500 dark:text-zinc-400 text-sm">
              読み込み中...
            </p>
          </div>
        </div>
      }
    >
      <TaskDetailClient />
    </Suspense>
  );
}
