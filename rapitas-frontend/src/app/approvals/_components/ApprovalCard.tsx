/**
 * ApprovalCard
 *
 * Renders a single subtask-decomposition approval request card with expandable
 * subtask list and per-subtask selection for partial approval.
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  CheckCircle,
  XCircle,
  Clock,
  ChevronRight,
  Loader2,
  ListChecks,
} from 'lucide-react';
import type { ApprovalRequest, Priority } from '@/types';
import { priorityColors, priorityLabels } from '@/types';
import { getTaskDetailPath } from '@/utils/tauri';
import { CheckboxButton } from './CheckboxButton';

/** Tailwind colour classes keyed by approval status. */
const STATUS_COLORS: Record<string, string> = {
  pending:
    'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  approved:
    'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  expired: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
};

interface ApprovalCardProps {
  approval: ApprovalRequest;
  isSelected: boolean;
  isExpanded: boolean;
  isProcessing: boolean;
  isPending: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  /** Called with optional indices when approving a partial subtask selection. */
  onApprove: (selectedSubtasks?: number[]) => void;
  onReject: () => void;
  formatDate: (date: string) => string;
}

/**
 * Card component for a subtask-decomposition approval request.
 *
 * @param props - See ApprovalCardProps
 */
export function ApprovalCard({
  approval,
  isSelected,
  isExpanded,
  isProcessing,
  isPending,
  onToggleSelect,
  onToggleExpand,
  onApprove,
  onReject,
  formatDate,
}: ApprovalCardProps) {
  const t = useTranslations('approvals');
  const [selectedSubtasks, setSelectedSubtasks] = useState<Set<number>>(
    new Set(approval.proposedChanges.subtasks?.map((_, i) => i) || []),
  );

  /**
   * Toggle individual subtask selection.
   *
   * @param index - Zero-based subtask index / <サブタスクのインデックス>
   */
  const toggleSubtask = (index: number) => {
    setSelectedSubtasks((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const statusLabels: Record<string, string> = {
    pending: t('pending'),
    approved: t('approved'),
    rejected: t('rejected'),
    expired: t('expired'),
  };

  const subtaskCount = approval.proposedChanges.subtasks?.length || 0;
  const allSelected = selectedSubtasks.size === subtaskCount;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Main Content */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {isPending && (
            <CheckboxButton
              checked={isSelected}
              onClick={onToggleSelect}
              className="mt-1"
            />
          )}

          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-2">
              <div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {approval.title}
                </h3>
                {approval.config?.task && (
                  <Link
                    href={getTaskDetailPath(approval.config.task.id)}
                    className="text-sm text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    {t('task')}: {approval.config.task.title}
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[approval.status]}`}
                >
                  {statusLabels[approval.status]}
                </span>
              </div>
            </div>

            {/* Description */}
            {approval.description && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3 line-clamp-3">
                {approval.description.length > 200
                  ? approval.description
                      .substring(0, 200)
                      .replace(/\s+\S*$/, '') + '...'
                  : approval.description}
              </p>
            )}

            {/* Meta */}
            <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1">
                <ListChecks className="w-3.5 h-3.5" />
                {t('subtaskCount', { count: subtaskCount })}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {formatDate(approval.createdAt)}
              </span>
            </div>
          </div>

          {/* Expand Button */}
          <button
            onClick={onToggleExpand}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
          >
            <ChevronRight
              className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          {/* Subtasks List */}
          <div className="p-4">
            <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">
              {t('proposedSubtasks')}
            </h4>
            <div className="space-y-2">
              {approval.proposedChanges.subtasks?.map((subtask, index) => (
                <div
                  key={index}
                  className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                    isPending
                      ? selectedSubtasks.has(index)
                        ? 'border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                      : 'border-zinc-200 dark:border-zinc-700'
                  }`}
                >
                  {isPending && (
                    <CheckboxButton
                      checked={selectedSubtasks.has(index)}
                      onClick={() => toggleSubtask(index)}
                      className="mt-0.5"
                    />
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">
                      {subtask.title}
                    </p>
                    {subtask.description && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                        {subtask.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${priorityColors[subtask.priority as Priority]}`}
                      >
                        {priorityLabels[subtask.priority as Priority]}
                      </span>
                      {subtask.estimatedHours && (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {t('approxHours', { hours: subtask.estimatedHours })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Reasoning */}
          {approval.proposedChanges.reasoning && (
            <div className="px-4 pb-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                <span className="font-medium">{t('decompositionReason')}</span>{' '}
                {approval.proposedChanges.reasoning}
              </p>
            </div>
          )}

          {/* Actions (pending only) */}
          {isPending && (
            <div className="flex items-center justify-end gap-3 px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-800">
              <button
                onClick={onReject}
                disabled={isProcessing}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                {t('reject')}
              </button>
              <button
                onClick={() =>
                  onApprove(
                    allSelected ? undefined : Array.from(selectedSubtasks),
                  )
                }
                disabled={isProcessing || selectedSubtasks.size === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                {allSelected
                  ? t('approveAll')
                  : t('approveCount', { count: selectedSubtasks.size })}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
