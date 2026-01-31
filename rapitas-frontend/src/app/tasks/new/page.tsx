import { Suspense } from "react";
import NewTaskClient from "./NewTaskClient";

export default function NewTaskPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-zinc-500 dark:text-zinc-400">読み込み中...</div>
        </div>
      }
    >
      <NewTaskClient />
    </Suspense>
  );
}
