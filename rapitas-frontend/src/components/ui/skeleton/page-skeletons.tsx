/**
 * page-skeletons
 *
 * Page-level skeleton loaders: LoadingSpinner (generic page), ListSkeleton (entity list),
 * and NewTaskSkeleton (new task form).
 * Not responsible for task card–specific skeletons; see task-card-skeleton.tsx.
 */

import { SkeletonBlock } from './skeleton-blocks';

/** Props for ListSkeleton. */
interface ListSkeletonProps {
  /** Number of list rows to render / 表示する行数 */
  count?: number;
  /** Whether to render tab placeholders above the list / タブプレースホルダーを表示するか */
  showTabs?: boolean;
  /** Whether to render badge placeholders on each row / バッジプレースホルダーを表示するか */
  showBadges?: boolean;
}

/**
 * Skeleton for a generic entity list (e.g. categories, themes).
 *
 * @param count - Number of placeholder rows / プレースホルダー行数
 * @param showTabs - Render tab skeletons at the top / タブスケルトンを上部に表示
 * @param showBadges - Render badge skeletons on each row / 各行にバッジスケルトンを表示
 */
export const ListSkeleton = ({
  count = 4,
  showTabs = false,
  showBadges = false,
}: ListSkeletonProps) => {
  return (
    <div>
      {showTabs && (
        <div className="mb-6 flex items-center gap-2">
          {[1, 2, 3].map((i) => (
            <SkeletonBlock
              key={i}
              className={`h-10 rounded-lg ${i === 1 ? 'w-28' : i === 2 ? 'w-24' : 'w-20'}`}
            />
          ))}
        </div>
      )}
      <div className="grid gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-indigo-dark-900 p-5"
          >
            <div className="flex items-center gap-4">
              <SkeletonBlock className="w-6 h-6 rounded" />
              <SkeletonBlock className="w-14 h-14 rounded-xl shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <SkeletonBlock
                    className={`h-6 ${i % 2 === 0 ? 'w-40' : 'w-32'}`}
                  />
                  {showBadges && (
                    <SkeletonBlock className="h-5 w-16 rounded-full" />
                  )}
                </div>
                <SkeletonBlock
                  className={`h-4 ${i % 3 === 0 ? 'w-64' : i % 3 === 1 ? 'w-48' : 'w-56'}`}
                />
                <div className="flex items-center gap-3">
                  <SkeletonBlock className="h-6 w-20 rounded-md" />
                  <SkeletonBlock className="h-4 w-16" />
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <SkeletonBlock className="h-9 w-28 rounded-lg" />
                <SkeletonBlock className="h-9 w-16 rounded-lg" />
                <SkeletonBlock className="h-9 w-16 rounded-lg" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Props for LoadingSpinner. */
interface PageSkeletonProps {
  /** Layout variant: 'default' fills the viewport, 'compact' uses 50vh / レイアウトバリアント */
  variant?: 'default' | 'compact';
}

/**
 * Generic page-level skeleton loader that renders a header, main card, and secondary card.
 *
 * @param variant - Height variant for the container / コンテナの高さバリアント
 */
export const LoadingSpinner = ({ variant = 'default' }: PageSkeletonProps) => {
  const heightClass =
    variant === 'compact' ? 'min-h-[50vh]' : 'h-[calc(100vh-5rem)]';

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
                  className={`h-4 ${i === 1 ? 'w-3/4' : i === 2 ? 'w-1/2' : 'w-2/3'}`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Skeleton loader for the new-task creation form.
 * Mirrors the accordion-based layout with title, priority, theme, description, and subtasks sections.
 */
export const NewTaskSkeleton = () => {
  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-background scrollbar-thin">
      {/* Header */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SkeletonBlock className="w-5 h-5 rounded" />
            <SkeletonBlock className="w-10 h-4" />
          </div>
          <div className="flex items-center gap-2">
            <SkeletonBlock className="w-24 h-9 rounded-xl" />
            <SkeletonBlock className="w-14 h-9 rounded-xl" />
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pb-8">
        {/* Main Card */}
        <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl shadow-zinc-200/50 dark:shadow-none border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
          {/* Title Section */}
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <SkeletonBlock className="h-6 w-3/4" />
          </div>

          {/* Priority & Theme - Compact inline */}
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex gap-6">
              {/* Priority */}
              <div className="flex-1">
                <div className="flex items-center gap-1 mb-2">
                  <SkeletonBlock className="w-3.5 h-3.5 rounded" />
                  <SkeletonBlock className="w-12 h-3" />
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4].map((i) => (
                    <SkeletonBlock key={i} className="w-10 h-6 rounded-md" />
                  ))}
                </div>
              </div>

              {/* Theme */}
              <div className="flex-1">
                <div className="flex items-center gap-1 mb-2">
                  <SkeletonBlock className="w-3.5 h-3.5 rounded" />
                  <SkeletonBlock className="w-10 h-3" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3].map((i) => (
                    <SkeletonBlock key={i} className="w-12 h-5 rounded-lg" />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* TaskSuggestions placeholder - matches actual structure */}
          <div className="border-b border-zinc-200 dark:border-zinc-800/50">
            <div className="flex items-center justify-between px-3 py-1.5">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <SkeletonBlock className="w-3 h-3 rounded" />
                  <SkeletonBlock className="w-16 h-3 rounded" />
                </div>
              </div>
              <div className="flex items-center gap-1">
                <SkeletonBlock className="w-20 h-5 rounded-md" />
              </div>
            </div>
          </div>

          {/* Description - Accordion */}
          <div className="border-b border-zinc-100 dark:border-zinc-800">
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SkeletonBlock className="w-3.5 h-3.5 rounded" />
                <SkeletonBlock className="w-8 h-3" />
              </div>
              <SkeletonBlock className="w-20 h-6 rounded-lg" />
            </div>
            <div className="px-3 pb-3">
              <SkeletonBlock className="w-full h-20 rounded-xl" />
            </div>
          </div>

          {/* Advanced Options - Accordion (collapsed) */}
          <div className="border-b border-zinc-100 dark:border-zinc-800">
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SkeletonBlock className="w-3.5 h-3.5 rounded" />
                <SkeletonBlock className="w-12 h-3" />
              </div>
              <SkeletonBlock className="w-3 h-3 rounded" />
            </div>
          </div>

          {/* Subtasks - Accordion (collapsed) */}
          <div className="">
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SkeletonBlock className="w-3.5 h-3.5 rounded" />
                <SkeletonBlock className="w-16 h-3" />
              </div>
              <SkeletonBlock className="w-3 h-3 rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
