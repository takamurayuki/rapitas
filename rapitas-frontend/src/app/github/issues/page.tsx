import { Suspense } from "react";
import IssuesClient from "./IssuesClient";

export default function GitHubIssuesPage() {
  return (
    <Suspense
      fallback={
        <div className="h-[calc(100vh-5rem)] flex items-center justify-center bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black scrollbar-thin">
          <div className="text-zinc-500 dark:text-zinc-400">読み込み中...</div>
        </div>
      }
    >
      <IssuesClient />
    </Suspense>
  );
}
