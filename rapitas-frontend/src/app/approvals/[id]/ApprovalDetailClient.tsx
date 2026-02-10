"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

export default function ApprovalDetailClient() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  useEffect(() => {
    // /approvals ページにリダイレクトし、expandパラメータで該当IDを展開
    router.replace(`/approvals?expand=${id}`);
  }, [router, id]);

  return <LoadingSpinner variant="compact" />;
}
