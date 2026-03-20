/**
 * filter-section-skeleton
 *
 * Skeleton for the task filter bar: category tabs, theme tabs, and accordion expanded content.
 * Extracted to keep task-card-skeleton.tsx within the 300-line guideline.
 */

import { EnhancedSkeletonBlock } from './skeleton-blocks';

/**
 * Renders a skeleton placeholder matching the layout of the task filter accordion.
 */
export function FilterSectionSkeleton() {
  return (
    <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm transition-all duration-300 mb-4">
      {/* Category tabs (horizontal scroll) */}
      <div className="flex items-center overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600 scrollbar-track-transparent bg-slate-50 dark:bg-slate-800/50">
        <div className="flex gap-2 px-3 py-2 min-w-max">
          <EnhancedSkeletonBlock className="w-16 h-6 rounded-md" delay={0} />
          <EnhancedSkeletonBlock className="w-20 h-6 rounded-md" delay={100} />
          <EnhancedSkeletonBlock className="w-12 h-6 rounded-md" delay={200} />
          <EnhancedSkeletonBlock className="w-18 h-6 rounded-md" delay={300} />
          <EnhancedSkeletonBlock className="w-14 h-6 rounded-md" delay={400} />
        </div>
      </div>

      {/* Theme tabs */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600 scrollbar-track-transparent flex-1">
          <EnhancedSkeletonBlock className="w-12 h-5 rounded-sm" delay={100} />
          <EnhancedSkeletonBlock className="w-16 h-5 rounded-sm" delay={200} />
          <EnhancedSkeletonBlock className="w-10 h-5 rounded-sm" delay={300} />
          <EnhancedSkeletonBlock className="w-14 h-5 rounded-sm" delay={400} />
        </div>
        <EnhancedSkeletonBlock className="w-12 h-6 rounded shrink-0" delay={500} />
      </div>

      {/* Accordion expanded content */}
      <div className="px-3 pb-3 border-t border-slate-200 dark:border-slate-700">
        <div className="grid grid-cols-3 gap-3 mb-2">
          <div>
            <EnhancedSkeletonBlock className="w-16 h-3 mb-1.5" delay={200} />
            <div className="flex gap-1">
              <EnhancedSkeletonBlock className="w-6 h-5 rounded-sm" delay={300} />
              <EnhancedSkeletonBlock className="w-6 h-5 rounded-sm" delay={400} />
              <EnhancedSkeletonBlock className="w-6 h-5 rounded-sm" delay={500} />
            </div>
          </div>
          <div>
            <EnhancedSkeletonBlock className="w-12 h-3 mb-1.5" delay={300} />
            <div className="flex gap-1">
              <EnhancedSkeletonBlock className="w-5 h-5 rounded-sm" delay={400} />
              <EnhancedSkeletonBlock className="w-5 h-5 rounded-sm" delay={500} />
              <EnhancedSkeletonBlock className="w-5 h-5 rounded-sm" delay={600} />
              <EnhancedSkeletonBlock className="w-5 h-5 rounded-sm" delay={700} />
            </div>
          </div>
          <div>
            <EnhancedSkeletonBlock className="w-14 h-3 mb-1.5" delay={400} />
            <EnhancedSkeletonBlock className="w-20 h-5 rounded-sm" delay={500} />
          </div>
        </div>
      </div>
    </div>
  );
}
