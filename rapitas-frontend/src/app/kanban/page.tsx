/**
 * KanbanPage
 *
 * Weekly Kanban board page. Composes useKanbanBoard (task state + D&D),
 * useKanbanFilters (filter state), KanbanWeekNav, KanbanFilterBar, and
 * KanbanColumn for a fully featured drag-and-drop weekly view.
 */
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { DragDropContext } from '@hello-pangea/dnd';
import TaskSlidePanel from '@/feature/tasks/components/TaskSlidePanel';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';
import { useKanbanFilters } from './useKanbanFilters';
import { useKanbanBoard } from './useKanbanBoard';
import { KanbanWeekNav } from './components/KanbanWeekNav';
import { KanbanFilterBar } from './components/KanbanFilterBar';
import { KanbanColumn } from './components/KanbanColumn';

const logger = createLogger('KanbanPage');

type Priority = 'low' | 'medium' | 'high' | 'urgent';

const PRIORITY_STYLES: Record<Priority, { color: string; bg: string }> = {
  low: { color: 'text-slate-600', bg: 'bg-slate-100 dark:bg-slate-800' },
  medium: { color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900' },
  high: { color: 'text-amber-600', bg: 'bg-amber-100 dark:bg-amber-900' },
  urgent: { color: 'text-rose-600', bg: 'bg-rose-100 dark:bg-rose-900' },
};

const COLUMN_DEFS = [
  { id: 'todo' },
  { id: 'in-progress' },
  { id: 'done' },
] as const;

/**
 * Calculates start and end dates for a week offset from today.
 * Monday is treated as the week start.
 *
 * @param weekOffset - 0 = current week, negative = past, positive = future
 * @returns start and end Date objects for the requested week
 */
function getWeekDateRange(weekOffset: number): { start: Date; end: Date } {
  const now = new Date();
  const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + diff + weekOffset * 7);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return { start: weekStart, end: weekEnd };
}

export default function KanbanPage() {
  const t = useTranslations('kanban');
  const tt = useTranslations('task');
  const tc = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  const priorityConfig: Record<Priority, { label: string; color: string; bg: string }> = {
    low: { label: tt('priorityLow'), ...PRIORITY_STYLES.low },
    medium: { label: tt('priorityMedium'), ...PRIORITY_STYLES.medium },
    high: { label: tt('priorityHigh'), ...PRIORITY_STYLES.high },
    urgent: { label: t('priorityUrgent'), ...PRIORITY_STYLES.urgent },
  };

  const columns = COLUMN_DEFS.map((col) => ({
    ...col,
    label:
      col.id === 'todo'
        ? tt('statusTodo')
        : col.id === 'in-progress'
          ? tt('statusInProgress')
          : tt('statusDone'),
  }));

  const [showFilters, setShowFilters] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(0);

  const currentWeekRange = useMemo(() => getWeekDateRange(currentWeek), [currentWeek]);

  const {
    tasks,
    taskCacheLoading,
    loading,
    selectedTaskId,
    isPanelOpen,
    fetchTasks,
    onDragEnd,
    openTaskPanel,
    closeTaskPanel,
    openTaskInPage,
    getKanbanExecutionClasses,
  } = useKanbanBoard(tt('running'), tt('waitingForInput'), t('updateFailed'));

  const {
    searchQuery,
    setSearchQuery,
    selectedPriorities,
    selectedLabelIds,
    labels,
    setLabels,
    filteredTasks,
    hasActiveFilters,
    clearFilters,
    togglePriority,
    toggleLabel,
  } = useKanbanFilters({
    tasks,
    weekStart: currentWeekRange.start,
    weekEnd: currentWeekRange.end,
  });

  useEffect(() => {
    const fetchLabels = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/labels`);
        if (res.ok) setLabels(await res.json());
      } catch (e) {
        logger.error('Failed to fetch labels:', e);
      }
    };
    fetchLabels();
  }, [setLabels]);

  const getWeekDisplayText = () => {
    const fmt = (d: Date) =>
      d.toLocaleDateString(dateLocale, { month: 'numeric', day: 'numeric' });
    const start = fmt(currentWeekRange.start);
    const end = fmt(currentWeekRange.end);
    if (currentWeek === 0) return t('thisWeek', { start, end });
    if (currentWeek < 0) return t('weeksAgo', { count: Math.abs(currentWeek), start, end });
    return t('weeksLater', { count: currentWeek, start, end });
  };

  const getTasksByStatus = (status: string) =>
    filteredTasks.filter((task) => task.status === status && !task.parentId);

  return (
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background scrollbar-thin">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <KanbanWeekNav
          displayText={getWeekDisplayText()}
          onPrev={() => setCurrentWeek((w) => w - 1)}
          onNext={() => setCurrentWeek((w) => w + 1)}
          onBackToCurrentWeek={() => setCurrentWeek(0)}
          prevLabel={t('prevWeek')}
          nextLabel={t('nextWeek')}
          backLabel={t('backToThisWeek')}
        />

        <KanbanFilterBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters((v) => !v)}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
          selectedPriorities={selectedPriorities}
          onTogglePriority={togglePriority}
          priorityConfig={priorityConfig}
          selectedLabelIds={selectedLabelIds}
          onToggleLabel={toggleLabel}
          labels={labels}
          filteredCount={filteredTasks.filter((t) => !t.parentId).length}
          tc={tc}
          tt={tt}
          t={t}
        />

        {(loading || taskCacheLoading) && tasks.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-3">
                <div className="h-5 w-24 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
                {[1, 2].map((j) => (
                  <div key={j} className="h-20 bg-zinc-200 dark:bg-zinc-700 rounded-xl animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {columns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  columnId={column.id}
                  label={column.label}
                  tasks={getTasksByStatus(column.id)}
                  getExecutionClasses={getKanbanExecutionClasses}
                  dateLocale={dateLocale}
                  onOpenTask={openTaskPanel}
                  onOpenTaskInPage={openTaskInPage}
                  t={t}
                />
              ))}
            </div>
          </DragDropContext>
        )}
      </div>

      <TaskSlidePanel
        taskId={selectedTaskId}
        isOpen={isPanelOpen}
        onClose={closeTaskPanel}
        onTaskUpdated={fetchTasks}
      />
    </div>
  );
}
