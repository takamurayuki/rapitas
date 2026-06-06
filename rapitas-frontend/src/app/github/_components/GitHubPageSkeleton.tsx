/**
 * GitHubPageSkeleton
 *
 * Loading placeholder for the GitHub integration overview page.
 * Mirrors the real layout (header, CLI-status banner, repo card grid,
 * recent PR list) so the page does not visually jump when data arrives.
 */

/** A pulsing gray block used as a generic skeleton primitive. */
function Bar({ className = '' }: { className?: string }) {
  return <div className={`bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse ${className}`} />;
}

/** Skeleton matching one linked-repository card. */
function RepoCardSkeleton() {
  return (
    <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center justify-between mb-4">
        <Bar className="h-5 w-40" />
        <Bar className="h-7 w-7 rounded" />
      </div>
      <div className="flex items-center gap-4">
        <Bar className="h-4 w-16" />
        <Bar className="h-4 w-16" />
      </div>
    </div>
  );
}

/** Skeleton matching one recent-PR / recent-issue list row. */
function ListRowSkeleton() {
  return (
    <div className="flex items-center gap-4 p-3 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <Bar className="h-5 w-5 rounded-full" />
      <div className="flex-1 min-w-0 space-y-2">
        <Bar className="h-4 w-3/5" />
        <Bar className="h-3 w-2/5" />
      </div>
      <Bar className="h-6 w-14 rounded" />
    </div>
  );
}

/** Full-page loading skeleton for the GitHub overview page. */
export function GitHubPageSkeleton() {
  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-background scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header: title block + add button */}
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-2">
            <Bar className="h-7 w-48" />
            <Bar className="h-4 w-64" />
          </div>
          <Bar className="h-10 w-32 rounded-lg" />
        </div>

        {/* CLI status banner */}
        <Bar className="h-14 w-full rounded-lg mb-6" />

        {/* Linked repositories */}
        <div className="mb-8">
          <Bar className="h-6 w-32 mb-4" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <RepoCardSkeleton key={i} />
            ))}
          </div>
        </div>

        {/* Recent pull requests */}
        <div>
          <Bar className="h-6 w-40 mb-4" />
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <ListRowSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
