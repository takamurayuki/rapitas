/**
 * task-card-skeleton
 *
 * Skeleton loaders that replicate the visual layout of TaskCard and TaskList components.
 * Not responsible for page-level layout or filter UI skeletons.
 */

import { EnhancedSkeletonBlock } from './skeleton-blocks';
import { FilterSectionSkeleton } from './filter-section-skeleton';

/** Variation descriptor for a single task card skeleton. */
interface TaskCardVariation {
  id: number;
  hasSubtasks: boolean;
  hasEstimatedHours: boolean;
  hasLabels: boolean;
  hasOpenButton: boolean;
  labelCount: number;
  titleWidth: string;
  progressWidth: string | null;
  progressType: string | null;
  borderColor: string;
  delay: number;
}

/**
 * Generates four distinct task card variation patterns for visual diversity in the skeleton.
 *
 * @returns Array of TaskCardVariation descriptors / タスクカードのバリエーション配列
 */
export const generateTaskCardVariations = (): TaskCardVariation[] => {
  const cards: TaskCardVariation[] = [];
  const patterns = [
    // Pattern 1: Complex task (with subtasks and labels)
    {
      hasSubtasks: true,
      hasEstimatedHours: true,
      hasLabels: true,
      hasOpenButton: true,
      labelCount: 2,
      titleWidth: '75%',
      progressWidth: 'w-3/5',
    },
    // Pattern 2: Simple task
    {
      hasSubtasks: false,
      hasEstimatedHours: false,
      hasLabels: false,
      hasOpenButton: true,
      labelCount: 0,
      titleWidth: '55%',
      progressWidth: null,
    },
    // Pattern 3: Medium complexity
    {
      hasSubtasks: true,
      hasEstimatedHours: false,
      hasLabels: true,
      hasOpenButton: false,
      labelCount: 1,
      titleWidth: '85%',
      progressWidth: 'w-4/5',
    },
    // Pattern 4: Completed task
    {
      hasSubtasks: true,
      hasEstimatedHours: true,
      hasLabels: false,
      hasOpenButton: true,
      labelCount: 0,
      titleWidth: '60%',
      progressWidth: 'w-full',
    },
  ];

  const progressTypes = [
    'bg-zinc-400 dark:bg-zinc-500',
    'bg-zinc-400 dark:bg-zinc-500',
    'bg-zinc-400 dark:bg-zinc-500',
    'bg-zinc-400 dark:bg-zinc-500',
    'bg-zinc-400 dark:bg-zinc-500',
    'bg-zinc-400 dark:bg-zinc-500',
  ];

  const borderColors = [
    'border-l-zinc-300 dark:border-l-zinc-600',
    'border-l-zinc-300 dark:border-l-zinc-600',
    'border-l-zinc-300 dark:border-l-zinc-600',
    'border-l-zinc-300 dark:border-l-zinc-600',
    'border-l-zinc-300 dark:border-l-zinc-600',
    'border-l-zinc-300 dark:border-l-zinc-600',
  ];

  patterns.forEach((pattern, i) => {
    cards.push({
      id: i + 1,
      ...pattern,
      progressType:
        pattern.hasSubtasks && pattern.progressWidth
          ? `${progressTypes[i % progressTypes.length]} ${pattern.progressWidth}`
          : null,
      borderColor: borderColors[i % borderColors.length],
      delay: i * 50, // Staggered animation
    });
  });

  return cards;
};

/**
 * Renders a single task card skeleton row matching the actual TaskCard layout.
 *
 * @param card - Variation descriptor controlling which optional sections to render / スケルトン表示バリエーション
 */
function TaskCardSkeletonRow({ card }: { card: TaskCardVariation }) {
  return (
    <div
      className={`group relative rounded-lg border-l-4 border-t border-r border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-indigo-dark-900 transition-all duration-300 ease-out ${card.borderColor}`}
      style={{
        animationDelay: `${card.delay}ms`,
        animationFillMode: 'forwards',
      }}
    >
      <div className="flex items-center gap-3 px-3 py-2.5 transition-all duration-300 ease-out rounded-t-lg">
        {/* Left: Status icon (matches actual w-7 h-7 size) */}
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-zinc-200 dark:bg-zinc-700 shrink-0">
          <EnhancedSkeletonBlock
            className="w-4 h-4 rounded"
            delay={card.delay + 100}
            shimmer={true}
          />
        </div>

        {/* Center: Task info */}
        <div className="flex-1 min-w-0">
          {/* Title row (task title + priority icon) */}
          <div className="flex items-center gap-2 mb-1">
            <EnhancedSkeletonBlock
              className="h-4 rounded"
              style={{ width: card.titleWidth }}
              delay={card.delay + 150}
              shimmer={true}
            />
            {/* Priority icon */}
            <EnhancedSkeletonBlock
              className="w-4 h-4 rounded shrink-0"
              delay={card.delay + 200}
            />
          </div>

          {/* Meta info row (order: created date, subtask progress, estimated time, labels) */}
          <div className="flex items-center gap-2 text-xs mb-1.5">
            {/* Created date (always shown) */}
            <EnhancedSkeletonBlock
              className="h-3 w-12 rounded shrink-0"
              delay={card.delay + 250}
            />

            {/* Subtask progress (conditional) */}
            {card.hasSubtasks && (
              <>
                <span className="w-0.5 h-0.5 bg-zinc-300 dark:bg-zinc-600 rounded-full" />
                <EnhancedSkeletonBlock
                  className="h-3 w-10 rounded shrink-0"
                  delay={card.delay + 300}
                />
              </>
            )}

            {/* Estimated time (conditional) */}
            {card.hasEstimatedHours && (
              <>
                <span className="w-0.5 h-0.5 bg-zinc-300 dark:bg-zinc-600 rounded-full" />
                <EnhancedSkeletonBlock
                  className="h-3 w-6 rounded shrink-0"
                  delay={card.delay + 350}
                />
              </>
            )}

            {/* Labels (conditional) */}
            {card.hasLabels && (
              <>
                <span className="w-0.5 h-0.5 bg-zinc-300 dark:bg-zinc-600 rounded-full" />
                <div className="flex items-center gap-1 shrink-0">
                  {Array.from({ length: card.labelCount }, (_, i) => (
                    <EnhancedSkeletonBlock
                      key={i}
                      className="h-4 w-12 rounded-full"
                      delay={card.delay + 400 + i * 50}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Progress bar (shown only when subtasks exist) */}
          {card.hasSubtasks && card.progressType && (
            <div className="mt-1.5 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${card.progressType}`}
                style={{
                  animationDelay: `${card.delay + 500}ms`,
                }}
              />
            </div>
          )}
        </div>

        {/* Right: Quick actions (matches actual button layout) */}
        <div className="flex items-center gap-1 pl-3 self-stretch">
          {/* Status change buttons (always 3: todo, in-progress, done) */}
          {['todo', 'in-progress', 'done'].map((status, j) => (
            <EnhancedSkeletonBlock
              key={status}
              className="h-7 w-7 rounded-md"
              delay={card.delay + 600 + j * 50}
            />
          ))}
          {/* Open in page button (conditional) */}
          {card.hasOpenButton && (
            <EnhancedSkeletonBlock
              className="h-7 w-7 rounded-md"
              delay={card.delay + 750}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Props for TaskCardsSkeleton. */
interface TaskCardsSkeletonProps {
  /** Number of skeleton cards to render / 表示するスケルトンカード数 */
  count?: number;
}

/**
 * Standalone skeleton for a list of task cards without any surrounding filter or pagination UI.
 *
 * @param count - How many cards to render / 表示するカード数
 */
export const TaskCardsSkeleton = ({ count = 4 }: TaskCardsSkeletonProps) => {
  const baseVariations = generateTaskCardVariations();
  // Repeat base patterns up to the required count
  const cardVariations = Array.from({ length: count }, (_, i) => ({
    ...baseVariations[i % baseVariations.length],
    id: i + 1,
    delay: i * 50,
  }));

  return (
    <div className="space-y-3 animate-skeleton-fade-in">
      {cardVariations.map((card) => (
        <TaskCardSkeletonRow key={card.id} card={card} />
      ))}
    </div>
  );
};

// NOTE: FilterSectionSkeleton is defined in ./filter-section-skeleton.tsx and re-exported
// here via the barrel (LoadingSpinner.tsx) to stay within the 300-line guideline.
export { FilterSectionSkeleton } from './filter-section-skeleton';

/** Props for TaskListSkeleton. */
interface TaskListSkeletonProps {
  /** Whether to show filter UI skeleton / フィルターUIスケルトンを表示するか */
  showFilter?: boolean;
}

/**
 * Full-page skeleton for the task list view, including optional filter bar, cards, and pagination.
 *
 * @param showFilter - Whether to render the filter bar skeleton / フィルターバーのスケルトンを表示するか
 */
export const TaskListSkeleton = ({
  showFilter = true,
}: TaskListSkeletonProps) => {
  const cardVariations = generateTaskCardVariations();

  return (
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background">
      <div className="mx-auto max-w-6xl px-4 py-4">
        <div className="space-y-4 animate-skeleton-fade-in">
          {showFilter && <FilterSectionSkeleton />}

          {/* Task cards */}
          <div className="space-y-3">
            {cardVariations.map((card) => (
              <TaskCardSkeletonRow key={card.id} card={card} />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-4">
            <EnhancedSkeletonBlock className="w-32 h-4" delay={1000} />
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <EnhancedSkeletonBlock
                  key={i}
                  className="w-8 h-8 rounded"
                  delay={1100 + i * 50}
                />
              ))}
            </div>
            <EnhancedSkeletonBlock className="w-24 h-4" delay={1400} />
          </div>
        </div>
      </div>
    </div>
  );
};
