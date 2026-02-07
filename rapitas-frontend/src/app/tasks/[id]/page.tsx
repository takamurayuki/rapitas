import { Suspense } from "react";
import TaskDetailClient from "./TaskDetailClient";
import TaskDetailSkeleton from "@/components/ui/skeleton/TaskDetailSkeleton";

// 静的エクスポート用 - プレースホルダーIDを生成
export async function generateStaticParams() {
  // プレースホルダーとして_placeholder を使用
  // ビルドスクリプトで実際のIDにリダイレクトされる
  return [{ id: "_placeholder" }];
}

export default function TaskDetailPage() {
  return (
    <Suspense fallback={<TaskDetailSkeleton />}>
      <TaskDetailClient />
    </Suspense>
  );
}
