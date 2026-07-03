'use client';
// HomeTaskList
import { useRouter } from 'next/navigation';
import type { Status, Task } from '@/types';
import TaskCard from '@/feature/tasks/components/TaskCard';
import Pagination from '@/components/ui/pagination/Pagination';
import { TaskCardsSkeleton } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/empty-state';
import { SwatchBook, Plus, ListPlus, FolderOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface HomeTaskListProps {
  paginatedTasks: Task[];
  sortedTasksCount: number;
  isLoading: boolean;
  /** Whether the task cache has completed its first fetch / タスクキャッシュが初回取得を終えたか */
  initialized: boolean;
  categoryFilter: number | null;
  themesInCategoryCount: number;
  themeFilter: number | null;
  defaultThemeId: number | undefined;
  selectedTasks: Set<number>;
  isSelectionMode: boolean;
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
  initialized,
  categoryFilter,
  themesInCategoryCount,
  themeFilter,
  defaultThemeId,
  selectedTasks,
  isSelectionMode,
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

  // Show the skeleton until the cache's first fetch resolves (initialized) as well
  // as during loads — otherwise the empty state flashes for a frame on initial mount.
  if ((!initialized || isLoading) && sortedTasksCount === 0) {
    return <TaskCardsSkeleton count={10} />;
  }

  if (sortedTasksCount === 0) {
    // Empty state: no themes for the selected category
    if (categoryFilter !== null && themesInCategoryCount === 0) {
      return (
        <EmptyState
          icon={SwatchBook}
          title={t('noThemes')}
          description={t('noThemesDescription')}
          action={
            <button
              onClick={() => router.push('/themes')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg select-none text-sm font-medium text-purple-700 dark:text-purple-300 bg-white dark:bg-zinc-900 border border-purple-200 dark:border-purple-800 shadow-[0_2px_0_0_#d8b4fe] dark:shadow-[0_2px_0_0_#4c1d95] transition-all duration-75 hover:bg-purple-50 dark:hover:bg-purple-900/20 active:translate-y-[2px] active:shadow-none"
            >
              <Plus className="w-5 h-5" />
              {t('addTheme')}
            </button>
          }
        />
      );
    }

    // Empty state: no tasks match current filters
    return (
      <EmptyState
        icon={FolderOpen}
        title={t('noTasks')}
        description={t('noTasksDescription')}
        action={
          <button
            onClick={() => {
              const themeParam = themeFilter || defaultThemeId;
              router.push(`/tasks/new${themeParam ? `?themeId=${themeParam}` : ''}`);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg select-none text-sm font-medium text-blue-700 dark:text-blue-300 bg-white dark:bg-zinc-900 border border-blue-200 dark:border-blue-800 shadow-[0_2px_0_0_#93c5fd] dark:shadow-[0_2px_0_0_#1e3a8a] transition-all duration-75 hover:bg-blue-50 dark:hover:bg-blue-900/20 active:translate-y-[2px] active:shadow-none"
          >
            <ListPlus className="w-5 h-5" />
            {t('createTask')}
          </button>
        }
      />
    );
  }

  return (
    <>
      {/* NOTE: grid-cols-1 (= minmax(0, 1fr)) を明示しないとカラムが content-sized になり、
          長いタイトルがコンテナ幅を押し広げて truncate が効かなくなる。min-w-0 と併せて指定する。
          NOTE: 以前は各カードに slide-in-bottom + animationDelay、その後コンテナ単発の
          animate-in fade-in を付けていたが、グリッドが 0件↔正値で再マウントされるたびに
          再生されちらつく原因になっていたため撤去。スケルトン→グリッドの遷移自体で十分。 */}
      <div className="grid grid-cols-1 gap-3 min-w-0">
        {paginatedTasks.map((task) => (
          <TaskCard
            key={task.id}
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
          />
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
