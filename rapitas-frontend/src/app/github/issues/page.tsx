import { Suspense } from "react";
import IssuesClient from "./IssuesClient";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

export default function GitHubIssuesPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <IssuesClient />
    </Suspense>
  );
}
