"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";

export default function ApprovalDetailClient() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  useEffect(() => {
    // /approvals ページにリダイレクトし、expandパラメータで該当IDを展開
    router.replace(`/approvals?expand=${id}`);
  }, [router, id]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-pulse text-zinc-500 dark:text-zinc-400">
        読み込み中...
      </div>
    </div>
  );
}
