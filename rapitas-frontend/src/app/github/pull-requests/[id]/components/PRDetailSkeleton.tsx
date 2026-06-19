/**
 * PRDetailSkeleton
 *
 * Loading skeleton matching the pull-request DETAIL layout (header → merge bar →
 * tab nav → 2-col content + sidebar). Replaces the generic task-detail-shaped
 * LoadingSpinner, which did not match this page and looked broken while loading.
 */
import { SkeletonBlock } from '@/components/ui/skeleton/skeleton-blocks';

/** Skeleton for the PR detail page while data is being fetched. */
export function PRDetailSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" aria-busy="true">
      {/* Header: title + meta line */}
      <div className="mb-6 space-y-3">
        <SkeletonBlock className="h-8 w-2/3 rounded" />
        <div className="flex items-center gap-3">
          <SkeletonBlock className="h-6 w-20 rounded-full" />
          <SkeletonBlock className="h-4 w-48 rounded" />
        </div>
      </div>

      {/* Merge bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-3">
        <SkeletonBlock className="h-9 w-32 rounded-lg" />
        <SkeletonBlock className="h-9 w-44 rounded-lg" />
        <SkeletonBlock className="h-9 w-24 rounded-lg" />
        <SkeletonBlock className="ml-auto h-9 w-28 rounded-lg" />
        <SkeletonBlock className="h-9 w-20 rounded-lg" />
      </div>

      {/* Tab nav */}
      <div className="mb-6 flex items-center gap-4 border-b border-zinc-200 dark:border-zinc-700 pb-2">
        <SkeletonBlock className="h-6 w-28 rounded" />
        <SkeletonBlock className="h-6 w-28 rounded" />
      </div>

      {/* Content: 2-col main + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-4 space-y-2"
            >
              <SkeletonBlock className="h-5 w-1/2 rounded" />
              <SkeletonBlock className="h-4 w-full rounded" />
              <SkeletonBlock className="h-4 w-5/6 rounded" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <SkeletonBlock className="h-32 w-full rounded-lg" />
          <SkeletonBlock className="h-24 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
