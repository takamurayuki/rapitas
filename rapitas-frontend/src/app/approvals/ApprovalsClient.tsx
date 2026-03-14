'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  CheckCircle,
  XCircle,
  Clock,
  ChevronRight,
  Bot,
  Loader2,
  CheckCheck,
  AlertCircle,
  ListChecks,
  Code2,
  GitPullRequest,
} from 'lucide-react';
import { useApprovals } from '@/feature/developer-mode/hooks/useApprovals';
import { ExecutionReviewPanel } from '@/feature/developer-mode/components/ExecutionReviewPanel';
import Pagination from '@/components/ui/pagination/Pagination';
import type { ApprovalRequest, Priority, FileDiff } from '@/types';
import { priorityColors, priorityLabels } from '@/types';
import { getTaskDetailPath } from '@/utils/tauri';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';

const logger = createLogger('ApprovalsClient');

export default function ApprovalsClient() {
  const t = useTranslations('approvals');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  const searchParams = useSearchParams();
  const expandParam = searchParams.get('expand');
  const {
    approvals,
    isLoading,
    error,
    fetchApprovals,
    approve,
    reject,
    bulkApprove,
    fetchDiff,
    approveCodeReview,
    rejectCodeReview,
  } = useApprovals();
  const [filter, setFilter] = useState<string>('pending');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [codeReviewDiff, setCodeReviewDiff] = useState<Map<number, FileDiff[]>>(
    new Map(),
  );
  const [hasAutoExpanded, setHasAutoExpanded] = useState(false);

  useEffect(() => {
    fetchApprovals(filter);
    setCurrentPage(1);
  }, [filter, fetchApprovals]);

  // Read ID from URL parameter and auto-expand corresponding approval request
  useEffect(() => {
    if (expandParam && approvals.length > 0 && !hasAutoExpanded) {
      const targetId = parseInt(expandParam, 10);
      const targetApproval = approvals.find((a) => a.id === targetId);

      if (targetApproval) {
        setExpandedId(targetId);
        setHasAutoExpanded(true);

        // For code review, also fetch diff
        if (
          targetApproval.requestType === 'code_review' &&
          !codeReviewDiff.has(targetId)
        ) {
          if (targetApproval.proposedChanges?.structuredDiff?.length) {
            setCodeReviewDiff((prev) =>
              new Map(prev).set(
                targetId,
                targetApproval.proposedChanges.structuredDiff!,
              ),
            );
          } else {
            fetchDiff(targetId).then((files) => {
              setCodeReviewDiff((prev) => new Map(prev).set(targetId, files));
            });
          }
        }
      } else {
        // If target ID is not found in pending filter, try all filters
        if (filter === 'pending') {
          // Don't temporarily change filter to check approved and rejected
          // Instead, inform user it wasn't found or search other statuses
        }
      }
    }
  }, [
    expandParam,
    approvals,
    hasAutoExpanded,
    filter,
    codeReviewDiff,
    fetchDiff,
  ]);

  const handleApprove = async (id: number, selectedSubtasks?: number[]) => {
    setProcessingId(id);
    await approve(id, selectedSubtasks);
    setProcessingId(null);
    setExpandedId(null);
  };

  const handleReject = async (id: number) => {
    setProcessingId(id);
    await reject(id);
    setProcessingId(null);
    setExpandedId(null);
  };

  const handleCodeReviewApprove = async (
    id: number,
    commitMessage: string,
    baseBranch: string,
  ) => {
    setProcessingId(id);
    await approveCodeReview(id, commitMessage, baseBranch);
    setProcessingId(null);
    setExpandedId(null);
  };

  const handleCodeReviewReject = async (id: number) => {
    setProcessingId(id);
    await rejectCodeReview(id);
    setProcessingId(null);
    setExpandedId(null);
  };

  const handleRequestChanges = async (
    id: number,
    feedback: string,
    comments: { file?: string; content: string; type: string }[],
  ) => {
    setProcessingId(id);
    try {
      const res = await fetch(
        `${API_BASE_URL}/approvals/${id}/request-changes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback, comments }),
        },
      );
      if (res.ok) {
        await fetchApprovals(filter);
      }
    } catch (error) {
      logger.error('Failed to request changes:', error);
    } finally {
      setProcessingId(null);
      setExpandedId(null);
    }
  };

  const handleExpandCodeReview = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      // Fetch diff if not yet retrieved
      if (!codeReviewDiff.has(id)) {
        // First check proposedChanges structuredDiff
        const approval = approvals.find((a) => a.id === id);
        if (approval?.proposedChanges?.structuredDiff?.length) {
          setCodeReviewDiff((prev) =>
            new Map(prev).set(id, approval.proposedChanges.structuredDiff!),
          );
        } else {
          // Fetch from API
          const files = await fetchDiff(id);
          setCodeReviewDiff((prev) => new Map(prev).set(id, files));
        }
      }
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    await bulkApprove(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === approvals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(approvals.map((a) => a.id)));
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(dateLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
            <CheckCircle className="w-6 h-6 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {t('pendingList')}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('pendingSubtitle')}
            </p>
          </div>
        </div>

        {selectedIds.size > 0 && filter === 'pending' && (
          <button
            onClick={handleBulkApprove}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition-colors"
          >
            <CheckCheck className="w-4 h-4" />
            {t('bulkApprove', { count: selectedIds.size })}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-6">
        {[
          { value: 'pending', label: t('pending'), icon: Clock },
          { value: 'approved', label: t('approved'), icon: CheckCircle },
          { value: 'rejected', label: t('rejected'), icon: XCircle },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === f.value
                ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <f.icon className="w-4 h-4" />
            {f.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3 py-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 bg-zinc-200 dark:bg-zinc-700 rounded-xl animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && approvals.length === 0 && (
        <div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full mb-4">
            <Bot className="w-8 h-8 text-zinc-400" />
          </div>
          <p className="text-zinc-600 dark:text-zinc-400">
            {filter === 'pending'
              ? t('noPendingApprovals')
              : filter === 'approved'
                ? t('noApprovedApprovals')
                : t('noRejectedApprovals')}
          </p>
        </div>
      )}

      {/* Approvals List */}
      {!isLoading &&
        approvals.length > 0 &&
        (() => {
          const totalPages = Math.ceil(approvals.length / itemsPerPage);
          const startIndex = (currentPage - 1) * itemsPerPage;
          const paginatedApprovals = approvals.slice(
            startIndex,
            startIndex + itemsPerPage,
          );

          return (
            <div className="space-y-4">
              {/* Select All (pending only) */}
              {filter === 'pending' && (
                <div className="flex items-center gap-3 px-4 py-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                  <button
                    onClick={toggleSelectAll}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      selectedIds.size === approvals.length
                        ? 'border-violet-500 bg-violet-500'
                        : 'border-zinc-300 dark:border-zinc-600'
                    }`}
                  >
                    {selectedIds.size === approvals.length && (
                      <svg
                        className="w-3 h-3 text-white"
                        fill="currentColor"
                        viewBox="0 0 12 12"
                      >
                        <path d="M10.28 2.28a.75.75 0 00-1.06-1.06L4.5 5.94 2.78 4.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l5.25-5.25z" />
                      </svg>
                    )}
                  </button>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {t('selectAll')} ({selectedIds.size}/{approvals.length})
                  </span>
                </div>
              )}

              {paginatedApprovals.map((approval) =>
                approval.requestType === 'code_review' ? (
                  <CodeReviewCard
                    key={approval.id}
                    approval={approval}
                    isExpanded={expandedId === approval.id}
                    isProcessing={processingId === approval.id}
                    isPending={filter === 'pending'}
                    diffFiles={codeReviewDiff.get(approval.id) || []}
                    onToggleExpand={() => handleExpandCodeReview(approval.id)}
                    onApprove={(commitMessage, baseBranch) =>
                      handleCodeReviewApprove(
                        approval.id,
                        commitMessage,
                        baseBranch,
                      )
                    }
                    onReject={() => handleCodeReviewReject(approval.id)}
                    onRequestChanges={(feedback, comments) =>
                      handleRequestChanges(approval.id, feedback, comments)
                    }
                    formatDate={formatDate}
                    error={error}
                  />
                ) : (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    isSelected={selectedIds.has(approval.id)}
                    isExpanded={expandedId === approval.id}
                    isProcessing={processingId === approval.id}
                    isPending={filter === 'pending'}
                    onToggleSelect={() => toggleSelect(approval.id)}
                    onToggleExpand={() =>
                      setExpandedId(
                        expandedId === approval.id ? null : approval.id,
                      )
                    }
                    onApprove={(selected) =>
                      handleApprove(approval.id, selected)
                    }
                    onReject={() => handleReject(approval.id)}
                    formatDate={formatDate}
                  />
                ),
              )}

              {/* Pagination */}
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                itemsPerPage={itemsPerPage}
                onPageChange={setCurrentPage}
                onItemsPerPageChange={setItemsPerPage}
              />
            </div>
          );
        })()}
    </div>
  );
}

function ApprovalCard({
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
}: {
  approval: ApprovalRequest;
  isSelected: boolean;
  isExpanded: boolean;
  isProcessing: boolean;
  isPending: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onApprove: (selectedSubtasks?: number[]) => void;
  onReject: () => void;
  formatDate: (date: string) => string;
}) {
  const t = useTranslations('approvals');
  const [selectedSubtasks, setSelectedSubtasks] = useState<Set<number>>(
    new Set(approval.proposedChanges.subtasks?.map((_, i) => i) || []),
  );

  const toggleSubtask = (index: number) => {
    setSelectedSubtasks((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const statusColors = {
    pending:
      'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    approved:
      'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    expired: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
  };

  const statusLabels = {
    pending: t('pending'),
    approved: t('approved'),
    rejected: t('rejected'),
    expired: t('expired'),
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Main Content */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Checkbox (pending only) */}
          {isPending && (
            <button
              onClick={onToggleSelect}
              className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                isSelected
                  ? 'border-violet-500 bg-violet-500'
                  : 'border-zinc-300 dark:border-zinc-600'
              }`}
            >
              {isSelected && (
                <svg
                  className="w-3 h-3 text-white"
                  fill="currentColor"
                  viewBox="0 0 12 12"
                >
                  <path d="M10.28 2.28a.75.75 0 00-1.06-1.06L4.5 5.94 2.78 4.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l5.25-5.25z" />
                </svg>
              )}
            </button>
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
                  className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[approval.status]}`}
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
                {t('subtaskCount', {
                  count: approval.proposedChanges.subtasks?.length || 0,
                })}
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
                    <button
                      onClick={() => toggleSubtask(index)}
                      className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        selectedSubtasks.has(index)
                          ? 'border-violet-500 bg-violet-500'
                          : 'border-zinc-300 dark:border-zinc-600'
                      }`}
                    >
                      {selectedSubtasks.has(index) && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="currentColor"
                          viewBox="0 0 12 12"
                        >
                          <path d="M10.28 2.28a.75.75 0 00-1.06-1.06L4.5 5.94 2.78 4.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l5.25-5.25z" />
                        </svg>
                      )}
                    </button>
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
                    selectedSubtasks.size ===
                      (approval.proposedChanges.subtasks?.length || 0)
                      ? undefined
                      : Array.from(selectedSubtasks),
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
                {selectedSubtasks.size ===
                (approval.proposedChanges.subtasks?.length || 0)
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

function CodeReviewCard({
  approval,
  isExpanded,
  isProcessing,
  diffFiles,
  onToggleExpand,
  onApprove,
  onReject,
  onRequestChanges,
  formatDate,
  error,
}: {
  approval: ApprovalRequest;
  isExpanded: boolean;
  isProcessing: boolean;
  isPending: boolean;
  diffFiles: FileDiff[];
  onToggleExpand: () => void;
  onApprove: (commitMessage: string, baseBranch: string) => void;
  onReject: () => void;
  onRequestChanges: (
    feedback: string,
    comments: { file?: string; content: string; type: string }[],
  ) => void;
  formatDate: (date: string) => string;
  error: string | null;
}) {
  const t = useTranslations('approvals');
  const statusColors = {
    pending:
      'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    approved:
      'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    expired: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
  };

  const statusLabels = {
    pending: t('pending'),
    approved: t('approved'),
    rejected: t('rejected'),
    expired: t('expired'),
  };

  const defaultBranch = approval.config?.task?.theme?.defaultBranch || 'main';

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Main Content */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg shrink-0">
            <Code2 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>

          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {approval.title}
                  </h3>
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded text-xs font-medium">
                    <GitPullRequest className="w-3 h-3" />
                    {t('codeReview')}
                  </span>
                </div>
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
                  className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[approval.status]}`}
                >
                  {statusLabels[approval.status]}
                </span>
              </div>
            </div>

            {/* Meta */}
            <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1">
                <Code2 className="w-3.5 h-3.5" />
                {diffFiles.length > 0
                  ? t('filesChanged', { count: diffFiles.length })
                  : t('loadingChanges')}
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

      {/* Expanded Content - ExecutionReviewPanel */}
      {isExpanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          <ExecutionReviewPanel
            files={diffFiles}
            status="completed"
            onApprove={async (commitMessage, baseBranch) => {
              onApprove(commitMessage, baseBranch);
            }}
            onReject={async () => {
              onReject();
            }}
            onRequestChanges={async (feedback, comments) => {
              onRequestChanges(feedback, comments);
            }}
            isProcessing={isProcessing}
            error={error}
            defaultBranch={defaultBranch}
            implementationSummary={
              approval.proposedChanges?.implementationSummary
            }
            executionTimeMs={approval.proposedChanges?.executionTimeMs}
            taskId={approval.config?.task?.id}
            screenshots={approval.proposedChanges?.screenshots}
            workingDirectory={approval.proposedChanges?.workingDirectory}
          />
        </div>
      )}
    </div>
  );
}
