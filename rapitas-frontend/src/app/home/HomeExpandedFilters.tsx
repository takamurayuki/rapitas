/**
 * HomeExpandedFilters
 *
 * The collapsible panel containing status, priority, and sort controls.
 * Rendered inside HomeThemeFilter when the user toggles the filter button.
 */
'use client';
import React from 'react';
import type { Priority } from '@/types';
import { statusConfig } from '@/feature/tasks/config/StatusConfig';
import { priorityConfig } from '@/feature/tasks/components/PriorityIcon';
import { useTranslations } from 'next-intl';

interface StatusCounts {
  all: number;
  [key: string]: number;
}

interface HomeExpandedFiltersProps {
  filter: string;
  priorityFilter: Priority | null;
  sortBy: 'createdAt' | 'priority' | 'title';
  sortOrder: 'asc' | 'desc';
  isFilterExpanded: boolean;
  statusCounts: StatusCounts;
  onFilterChange: (status: string) => void;
  onPriorityChange: (priority: Priority | null) => void;
  onSortByChange: (sortBy: 'createdAt' | 'priority' | 'title') => void;
  onSortOrderToggle: () => void;
}

/**
 * Animated collapsible panel with status/priority/sort filter controls.
 *
 * @param props - Current filter values and change callbacks.
 * @returns The expanded filter panel JSX, collapsed when isFilterExpanded is false.
 */
export function HomeExpandedFilters({
  filter,
  priorityFilter,
  sortBy,
  sortOrder,
  isFilterExpanded,
  statusCounts,
  onFilterChange,
  onPriorityChange,
  onSortByChange,
  onSortOrderToggle,
}: HomeExpandedFiltersProps) {
  const t = useTranslations('home');

  return (
    <div
      className={`overflow-hidden transition-all duration-300 ease-out ${
        isFilterExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
      }`}
    >
      <div className="flex flex-wrap items-center gap-4 px-3 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30">
        {/* Status filter */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 whitespace-nowrap">
            STATUS:
          </span>
          <div className="flex items-center">
            {[
              { value: 'all', label: t('all'), color: 'amber' },
              { value: 'todo', label: statusConfig.todo.label, color: 'slate' },
              { value: 'in-progress', label: statusConfig['in-progress'].label, color: 'blue' },
              { value: 'done', label: statusConfig.done.label, color: 'green' },
            ].map((statusItem, idx) => {
              const count = statusCounts[statusItem.value] || 0;
              const isActive = filter === statusItem.value;
              return (
                <div key={statusItem.value} className="flex items-center">
                  <button
                    onClick={() => onFilterChange(statusItem.value)}
                    className={`relative h-6 px-3 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap transition-all duration-200 ${
                      isActive
                        ? statusItem.color === 'amber'
                          ? 'bg-linear-to-r from-amber-500 to-amber-400 text-white shadow-md font-bold'
                          : statusItem.color === 'blue'
                            ? 'bg-blue-500 text-white shadow-md font-bold'
                            : statusItem.color === 'green'
                              ? 'bg-green-500 text-white shadow-md font-bold'
                              : 'bg-slate-600 text-white shadow-md font-bold'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      {statusItem.label}
                      <span className="text-[9px] opacity-75">{count}</span>
                    </div>
                    {count > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-300 dark:bg-slate-600">
                        <div
                          className={`h-full transition-all duration-500 ${
                            isActive ? 'bg-white/50' : 'bg-slate-400 dark:bg-slate-500'
                          }`}
                          style={{
                            width: `${statusItem.value === 'all' ? 100 : (statusCounts[statusItem.value] / statusCounts.all) * 100}%`,
                          }}
                        />
                      </div>
                    )}
                  </button>
                  {idx < 3 && (
                    <div className="w-px h-4 bg-slate-300 dark:bg-slate-600" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="w-px h-6 bg-slate-300 dark:bg-slate-600" />

        {/* Priority filter */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 whitespace-nowrap">
            PRIORITY:
          </span>
          <div className="flex items-center">
            {[
              { value: '', label: t('all'), icon: null, iconColor: '', bgColor: 'amber' },
              ...(
                Object.entries(priorityConfig) as Array<
                  [keyof typeof priorityConfig, (typeof priorityConfig)[keyof typeof priorityConfig]]
                >
              ).map(([key, cfg]) => ({
                value: key,
                label: cfg.title,
                icon: <cfg.Icon className="w-3 h-3" />,
                iconColor: cfg.color,
                bgColor:
                  key === 'urgent' ? 'red' :
                  key === 'high' ? 'orange' :
                  key === 'medium' ? 'blue' : 'slate',
              })),
            ].map((priority, idx) => (
              <div key={priority.value} className="flex items-center">
                <button
                  onClick={() =>
                    onPriorityChange(
                      priority.value ? (priority.value as Priority) : null,
                    )
                  }
                  className={`h-6 px-2.5 font-mono text-[10px] uppercase tracking-wider transition-all duration-200 whitespace-nowrap focus:outline-none focus-visible:outline-none focus-visible:ring-0 ${
                    (priorityFilter || '') === priority.value
                      ? priority.bgColor === 'amber'
                        ? 'bg-linear-to-r from-amber-500 to-amber-400 text-white shadow-md font-bold'
                        : priority.bgColor === 'red'
                          ? 'bg-red-500 text-white shadow-md font-bold'
                          : priority.bgColor === 'orange'
                            ? 'bg-orange-500 text-white shadow-md font-bold'
                            : priority.bgColor === 'blue'
                              ? 'bg-blue-500 text-white shadow-md font-bold'
                              : 'bg-slate-600 text-white shadow-md font-bold'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    {priority.icon && (
                      <span
                        className={
                          (priorityFilter || '') === priority.value
                            ? 'text-white'
                            : priority.iconColor
                        }
                      >
                        {priority.icon}
                      </span>
                    )}
                    {priority.label}
                  </div>
                </button>
                {idx < 4 && (
                  <div className="w-px h-4 bg-slate-300 dark:bg-slate-600" />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="w-px h-6 bg-slate-300 dark:bg-slate-600" />

        {/* Sort controls */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 whitespace-nowrap">
            SORT:
          </span>
          <div className="flex items-center">
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as typeof sortBy)}
              className="h-6 px-2 font-mono text-[10px] uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-r border-slate-300 dark:border-slate-600 focus:outline-none focus:ring-0 focus:bg-slate-200 dark:focus:bg-slate-700 transition-colors cursor-pointer"
            >
              <option value="createdAt">CREATED</option>
              <option value="title">TITLE</option>
              <option value="priority">PRIORITY</option>
            </select>
            <button
              onClick={onSortOrderToggle}
              className="h-6 px-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-0"
              title={sortOrder === 'asc' ? 'ASC' : 'DESC'}
            >
              <svg
                className={`w-3.5 h-3.5 text-slate-700 dark:text-slate-300 transition-transform ${
                  sortOrder === 'desc' ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 11l5-5m0 0l5 5m-5-5v12"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
