function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse ${className}`}
    />
  );
}

interface PageSkeletonProps {
  variant?: "default" | "compact";
}

export const LoadingSpinner = ({ variant = "default" }: PageSkeletonProps) => {
  const heightClass =
    variant === "compact"
      ? "min-h-[50vh]"
      : "h-[calc(100vh-5rem)]";

  return (
    <div className={`${heightClass} overflow-hidden bg-background`}>
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-2">
          <SkeletonBlock className="w-32 h-8 rounded-lg" />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="w-20 h-9 rounded-xl" />
            <SkeletonBlock className="w-9 h-9 rounded-xl" />
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden mb-6">
          {/* Title row */}
          <div className="p-5 border-b border-zinc-100 dark:border-zinc-800">
            <SkeletonBlock className="h-7 w-2/3" />
          </div>

          {/* Content rows */}
          <div className="p-5 border-b border-zinc-100 dark:border-zinc-800">
            <div className="space-y-2">
              <SkeletonBlock className="h-4 w-full" />
              <SkeletonBlock className="h-4 w-5/6" />
              <SkeletonBlock className="h-4 w-4/6" />
            </div>
          </div>

          {/* Meta row */}
          <div className="p-5">
            <div className="flex items-center gap-3">
              <SkeletonBlock className="w-16 h-6 rounded-full" />
              <SkeletonBlock className="w-20 h-6 rounded-full" />
              <SkeletonBlock className="w-14 h-6 rounded-full" />
            </div>
          </div>
        </div>

        {/* Secondary Card */}
        <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <SkeletonBlock className="w-5 h-5 rounded" />
              <SkeletonBlock className="w-24 h-5" />
            </div>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <SkeletonBlock className="w-5 h-5 rounded-full shrink-0" />
                <SkeletonBlock
                  className={`h-4 ${i === 1 ? "w-3/4" : i === 2 ? "w-1/2" : "w-2/3"}`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
