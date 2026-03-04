'use client';

function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse ${className}`}
    />
  );
}

export default function TaskDetailSkeleton() {
  return (
    <div className="h-[calc(100vh-5rem)] overflow-hidden bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header Actions */}
        <div className="mb-6 flex items-center justify-between gap-2">
          <div />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="w-20 h-9 rounded-xl" />
            <SkeletonBlock className="w-9 h-9 rounded-xl" />
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden mb-6">
          {/* Title + Status row */}
          <div className="p-5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3">
              <SkeletonBlock className="h-7 w-2/3" />
              <div className="flex items-center gap-1">
                <SkeletonBlock className="w-8 h-8 rounded-lg" />
                <SkeletonBlock className="w-8 h-8 rounded-lg" />
                <SkeletonBlock className="w-8 h-8 rounded-lg" />
              </div>
            </div>
          </div>

          {/* Accordion sections */}
          {/* Description */}
          <div className="p-5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <SkeletonBlock className="w-4 h-4 rounded" />
              <SkeletonBlock className="w-16 h-4" />
            </div>
            <div className="space-y-2">
              <SkeletonBlock className="h-4 w-full" />
              <SkeletonBlock className="h-4 w-5/6" />
              <SkeletonBlock className="h-4 w-4/6" />
              <SkeletonBlock className="h-4 w-3/4" />
            </div>
          </div>

          {/* Meta info row */}
          <div className="p-5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <SkeletonBlock className="w-4 h-4 rounded" />
              <SkeletonBlock className="w-20 h-4" />
            </div>
            <div className="flex items-center gap-3">
              <SkeletonBlock className="w-16 h-6 rounded-full" />
              <SkeletonBlock className="w-20 h-6 rounded-full" />
            </div>
          </div>

          {/* Labels */}
          <div className="p-5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <SkeletonBlock className="w-4 h-4 rounded" />
              <SkeletonBlock className="w-12 h-4" />
            </div>
            <div className="flex items-center gap-2">
              <SkeletonBlock className="w-14 h-6 rounded-full" />
              <SkeletonBlock className="w-18 h-6 rounded-full" />
            </div>
          </div>

          {/* Resources */}
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <SkeletonBlock className="w-4 h-4 rounded" />
              <SkeletonBlock className="w-12 h-4" />
            </div>
            <SkeletonBlock className="h-10 w-full rounded-lg" />
          </div>
        </div>

        {/* Subtasks section */}
        <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden mb-6">
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SkeletonBlock className="w-5 h-5 rounded" />
                <SkeletonBlock className="w-24 h-5" />
                <SkeletonBlock className="w-12 h-5 rounded-full" />
              </div>
              <SkeletonBlock className="w-24 h-1.5 rounded-full" />
            </div>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <SkeletonBlock className="w-5 h-5 rounded-full shrink-0" />
                <SkeletonBlock
                  className={`h-4 ${i === 1 ? 'w-3/4' : i === 2 ? 'w-1/2' : 'w-2/3'}`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
