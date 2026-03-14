export function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse ${className}`}
    />
  );
}

// Enhanced skeleton block with wave-like shimmer animation
export function EnhancedSkeletonBlock({
  className = '',
  delay = 0,
  shimmer = true,
  style,
}: {
  className?: string;
  delay?: number;
  shimmer?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-zinc-200 dark:bg-zinc-700 rounded ${className}`}
      style={{ animationDelay: `${delay}ms`, ...style }}
    >
      {shimmer && (
        <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/20 dark:via-zinc-500/10 to-transparent animate-[shimmer_2s_infinite] rounded" />
      )}
      <div className="w-full h-full bg-zinc-200 dark:bg-zinc-700 animate-pulse rounded" />
    </div>
  );
}

interface ListSkeletonProps {
  count?: number;
  showTabs?: boolean;
  showBadges?: boolean;
}

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

interface PageSkeletonProps {
  variant?: 'default' | 'compact';
}

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

// Task card variation type definition
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

// Generate task card variation patterns
const generateTaskCardVariations = (): TaskCardVariation[] => {
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

interface TaskListSkeletonProps {
  showFilter?: boolean; // Whether to show filter UI skeleton
}

// TaskList-specific skeleton loader (matches the actual TaskCard UI layout)
export const TaskListSkeleton = ({
  showFilter = true,
}: TaskListSkeletonProps) => {
  const cardVariations = generateTaskCardVariations();

  // Generate task card skeletons
  const TaskCardsSection = () => (
    <div className="space-y-3">
      {cardVariations.map((card) => (
        <div
          key={card.id}
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
      ))}
    </div>
  );

  // Pagination skeleton
  const PaginationSection = () => (
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
  );

  // Filter UI skeleton
  const FilterSection = () => (
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
        <EnhancedSkeletonBlock
          className="w-12 h-6 rounded shrink-0"
          delay={500}
        />
      </div>

      {/* Accordion expanded content */}
      <div className="px-3 pb-3 border-t border-slate-200 dark:border-slate-700">
        <div className="grid grid-cols-3 gap-3 mb-2">
          <div>
            <EnhancedSkeletonBlock className="w-16 h-3 mb-1.5" delay={200} />
            <div className="flex gap-1">
              <EnhancedSkeletonBlock
                className="w-6 h-5 rounded-sm"
                delay={300}
              />
              <EnhancedSkeletonBlock
                className="w-6 h-5 rounded-sm"
                delay={400}
              />
              <EnhancedSkeletonBlock
                className="w-6 h-5 rounded-sm"
                delay={500}
              />
            </div>
          </div>
          <div>
            <EnhancedSkeletonBlock className="w-12 h-3 mb-1.5" delay={300} />
            <div className="flex gap-1">
              <EnhancedSkeletonBlock
                className="w-5 h-5 rounded-sm"
                delay={400}
              />
              <EnhancedSkeletonBlock
                className="w-5 h-5 rounded-sm"
                delay={500}
              />
              <EnhancedSkeletonBlock
                className="w-5 h-5 rounded-sm"
                delay={600}
              />
              <EnhancedSkeletonBlock
                className="w-5 h-5 rounded-sm"
                delay={700}
              />
            </div>
          </div>
          <div>
            <EnhancedSkeletonBlock className="w-14 h-3 mb-1.5" delay={400} />
            <EnhancedSkeletonBlock
              className="w-20 h-5 rounded-sm"
              delay={500}
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background">
      <div className="mx-auto max-w-6xl px-4 py-4">
        <div className="space-y-4 animate-skeleton-fade-in">
          {showFilter && <FilterSection />}
          <TaskCardsSection />
          <PaginationSection />
        </div>
      </div>
    </div>
  );
};

// Task cards-only skeleton (no filter UI, no wrapper)
export const TaskCardsSkeleton = ({ count = 4 }: { count?: number }) => {
  const baseVariations = generateTaskCardVariations();
  // Repeat base patterns up to the required count
  const cardVariations = Array.from({ length: count }, (_, i) => ({
    ...baseVariations[i % baseVariations.length],
    id: i + 1,
    delay: i * 50, // Staggered animation
  }));

  return (
    <div className="space-y-3 animate-skeleton-fade-in">
      {cardVariations.map((card) => (
        <div
          key={card.id}
          className={`group relative rounded-lg border-l-4 border-t border-r border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-indigo-dark-900 transition-all duration-300 ease-out ${card.borderColor}`}
          style={{
            animationDelay: `${card.delay}ms`,
            animationFillMode: 'forwards',
          }}
        >
          <div className="flex items-center gap-3 px-3 py-2.5 transition-all duration-300 ease-out rounded-t-lg">
            {/* Left: Status icon */}
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-zinc-200 dark:bg-zinc-700 shrink-0">
              <EnhancedSkeletonBlock
                className="w-4 h-4 rounded"
                delay={card.delay + 100}
                shimmer={true}
              />
            </div>

            {/* Center: Task info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <EnhancedSkeletonBlock
                  className="h-4 rounded"
                  style={{ width: card.titleWidth }}
                  delay={card.delay + 150}
                  shimmer={true}
                />
                <EnhancedSkeletonBlock
                  className="w-4 h-4 rounded shrink-0"
                  delay={card.delay + 200}
                />
              </div>

              <div className="flex items-center gap-2 text-xs mb-1.5">
                <EnhancedSkeletonBlock
                  className="h-3 w-12 rounded shrink-0"
                  delay={card.delay + 250}
                />

                {card.hasSubtasks && (
                  <>
                    <span className="w-0.5 h-0.5 bg-zinc-300 dark:bg-zinc-600 rounded-full" />
                    <EnhancedSkeletonBlock
                      className="h-3 w-10 rounded shrink-0"
                      delay={card.delay + 300}
                    />
                  </>
                )}

                {card.hasEstimatedHours && (
                  <>
                    <span className="w-0.5 h-0.5 bg-zinc-300 dark:bg-zinc-600 rounded-full" />
                    <EnhancedSkeletonBlock
                      className="h-3 w-6 rounded shrink-0"
                      delay={card.delay + 350}
                    />
                  </>
                )}

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
            </div>

            {/* Right: Quick actions */}
            <div className="flex items-center gap-1 pl-3 self-stretch">
              {['todo', 'in-progress', 'done'].map((status, j) => (
                <EnhancedSkeletonBlock
                  key={status}
                  className="h-7 w-7 rounded-md"
                  delay={card.delay + 600 + j * 50}
                />
              ))}
              {card.hasOpenButton && (
                <EnhancedSkeletonBlock
                  className="h-7 w-7 rounded-md"
                  delay={card.delay + 750}
                />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// NewTask-specific skeleton loader
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
