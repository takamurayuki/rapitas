import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import PullRequestDetailClient from "./PullRequestDetailClient";

// 静的エクスポート用 - プレースホルダーIDを生成
export async function generateStaticParams() {
  return [{ id: "_placeholder" }];
}

export default function PullRequestDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      }
    >
      <PullRequestDetailClient />
    </Suspense>
  );
}
