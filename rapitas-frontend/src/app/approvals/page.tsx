import { Suspense } from "react";
import ApprovalsClient from "./ApprovalsClient";

export default function ApprovalsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-zinc-500 dark:text-zinc-400">読み込み中...</div>
        </div>
      }
    >
      <ApprovalsClient />
    </Suspense>
  );
}
