'use client';
// HomeTaskList
import { useRouter } from 'next/navigation';
import type { Status, Task } from '@/types';
import TaskCard from '@/feature/tasks/components/TaskCard';
import Pagination from '@/components/ui/pagination/Pagination';
import { TaskCardsSkeleton } from '@/components/ui/LoadingSpinner';
import { SwatchBook, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface HomeTaskListProps {
  paginatedTasks: Task[];
  sortedTasksCount: number;
  isLoading: boolean;
  categoryFilter: number | null;
  themesInCategoryCount: number;
  themeFilter: number | null;
  defaultThemeId: number | undefined;
  selectedTasks: Set<number>;
  isSelectionMode: boolean;
  sweepingTaskId: number | null;
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  onTaskClick: (taskId: number) => void;
  onStatusChange: (taskId: number, status: Status, cardElement?: HTMLElement) => void;
  onToggleSelect: (taskId: number) => void;
  onTaskUpdated: () => Promise<void>;
  onOpenInPage: (taskId: number) => void;
  onPageChange: (page: number) => void;
  onItemsPerPageChange: (count: number) => void;
}

/**
 * Task grid with loading state, empty state, and pagination.
 *
 * @param props - Task data, selection state, pagination, and action callbacks.
 * @returns The task list section JSX.
 */
export function HomeTaskList({
  paginatedTasks,
  sortedTasksCount,
  isLoading,
  categoryFilter,
  themesInCategoryCount,
  themeFilter,
  defaultThemeId,
  selectedTasks,
  isSelectionMode,
  sweepingTaskId,
  currentPage,
  totalPages,
  itemsPerPage,
  onTaskClick,
  onStatusChange,
  onToggleSelect,
  onTaskUpdated,
  onOpenInPage,
  onPageChange,
  onItemsPerPageChange,
}: HomeTaskListProps) {
  const router = useRouter();
  const t = useTranslations('home');

  if (isLoading && sortedTasksCount === 0) {
    return <TaskCardsSkeleton count={10} />;
  }

  if (sortedTasksCount === 0) {
    // Empty state: no themes for the selected category
    if (categoryFilter !== null && themesInCategoryCount === 0) {
      return (
        <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">
          <SwatchBook className="w-16 h-16 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
          <p className="text-lg font-medium mb-2">{t('noThemes')}</p>
          <p className="text-sm mb-4">{t('noThemesDescription')}</p>
          <button
            onClick={() => router.push('/themes')}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium transition-colors inline-flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            {t('addTheme')}
          </button>
        </div>
      );
    }

    // Empty state: no tasks match current filters
    return (
      <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">
        <svg
          className="w-16 h-16 mx-auto mb-4 text-zinc-300 dark:text-zinc-700"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        <p className="text-lg font-medium mb-2">{t('noTasks')}</p>
        <p className="text-sm mb-4">{t('noTasksDescription')}</p>
        <button
          onClick={() => {
            const themeParam = themeFilter || defaultThemeId;
            router.push(`/tasks/new${themeParam ? `?themeId=${themeParam}` : ''}`);
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors inline-flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('createTask')}
        </button>
      </div>
    );
  }

  return (
    <>
      {/* NOTE: grid-cols-1 (= minmax(0, 1fr)) を明示しないとカラムが content-sized になり、
          長いタイトルがコンテナ幅を押し広げて truncate が効かなくなる。min-w-0 と併せて指定する。 */}
      <div className="grid grid-cols-1 gap-3 min-w-0">
        {paginatedTasks.map((task, index) => (
          <div
            key={task.id}
            className="slide-in-bottom min-w-0"
            style={{
              animationDelay: `${index * 0.02}s`,
              animationFillMode: 'both',
            }}
          >
            <TaskCard
              task={task}
              isSelected={selectedTasks.has(task.id)}
              isSelectionMode={isSelectionMode}
              onTaskClick={onTaskClick}
              onStatusChange={(taskId: number, status: Status, cardElement?: HTMLElement) => {
                onStatusChange(taskId, status, cardElement);
              }}
              onToggleSelect={onToggleSelect}
              onTaskUpdated={onTaskUpdated}
              onOpenInPage={onOpenInPage}
              sweepingTaskId={sweepingTaskId}
            />
          </div>
        ))}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        itemsPerPage={itemsPerPage}
        onPageChange={onPageChange}
        onItemsPerPageChange={onItemsPerPageChange}
      />
    </>
  );
}
