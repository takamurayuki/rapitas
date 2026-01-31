import { Suspense } from "react";
import ApprovalDetailClient from "./ApprovalDetailClient";

// 静的エクスポート用 - プレースホルダーIDを生成
export async function generateStaticParams() {
  return [{ id: "_placeholder" }];
}

export default function ApprovalDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-zinc-500 dark:text-zinc-400">
            読み込み中...
          </div>
        </div>
      }
    >
      <ApprovalDetailClient />
    </Suspense>
  );
}
