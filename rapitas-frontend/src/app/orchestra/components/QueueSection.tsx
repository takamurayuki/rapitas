/**
 * QueueSection
 *
 * Collapsible list section displaying queue items in a given state category
 * (running, queued, waiting_approval, completed, failed).
 */
'use client';

import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { QueueItem } from '../types';
import { StatusBadge, PhaseBadge } from './OrchestraBadges';

interface QueueSectionProps {
  title: string;
  items: QueueItem[];
  expanded: boolean;
  onToggle: () => void;
  /** Optional cancel handler; omit for sections where cancellation is not applicable */
  onCancel?: (itemId: number) => void;
  actionLoading: string | null;
  icon: React.ReactNode;
}

/**
 * Collapsible queue section showing items for a single status category.
 * Returns null when items array is empty.
 *
 * @param title - Section heading including item count
 * @param items - Queue items to display
 * @param expanded - Whether the section body is visible
 * @param onToggle - Toggle expanded/collapsed state
 * @param onCancel - Optional cancel callback for eligible items
 * @param actionLoading - Loading key to disable individual cancel buttons
 * @param icon - Icon element displayed in the section header
 */
export function QueueSection({
  title,
  items,
  expanded,
  onToggle,
  onCancel,
  actionLoading,
  icon,
}: QueueSectionProps) {
  if (items.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {title}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between px-4 py-3 border-b last:border-b-0 border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    #{item.taskId} {item.task?.title || 'Unknown task'}
                  </span>
                  <StatusBadge status={item.status} />
                  <PhaseBadge phase={item.currentPhase} />
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {item.task?.theme && (
                    <span
                      className="px-1.5 py-0.5 rounded text-xs"
                      style={{
                        backgroundColor: `${item.task.theme.color}20`,
                        color: item.task.theme.color,
                      }}
                    >
                      {item.task.theme.name}
                    </span>
                  )}
                  <span>Priority: {item.priority}</span>
                  {item.retryCount > 0 && (
                    <span>
                      Retry: {item.retryCount}/{item.maxRetries}
                    </span>
                  )}
                  {item.errorMessage && (
                    <span className="text-red-500 truncate max-w-xs">
                      {item.errorMessage}
                    </span>
                  )}
                </div>
              </div>
              {onCancel &&
                (item.status === 'queued' || item.status === 'running') && (
                  <button
                    onClick={() => onCancel(item.id)}
                    disabled={actionLoading === `cancel-${item.id}`}
                    className="ml-2 p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
