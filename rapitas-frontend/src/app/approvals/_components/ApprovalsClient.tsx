/**
 * ApprovalsClient
 *
 * Top-level client component for the approvals page. Composes filter tabs,
 * bulk-approve controls, a paginated list of ApprovalCard / CodeReviewCard
 * items, and delegates all state management to useApprovalsClient.
 */
'use client';

import { useTranslations } from 'next-intl';
import {
  CheckCircle,
  XCircle,
  Clock,
  Bot,
  CheckCheck,
  AlertCircle,
} from 'lucide-react';
import Pagination from '@/components/ui/pagination/Pagination';
import { useApprovalsClient } from '../_hooks/useApprovalsClient';
import { ApprovalCard } from './ApprovalCard';
import { CodeReviewCard } from './CodeReviewCard';
import { CheckboxButton } from './CheckboxButton';

export default function ApprovalsClient() {
  const t = useTranslations('approvals');
  const {
    filter,
    setFilter,
    selectedIds,
    processingId,
    expandedId,
    setExpandedId,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
    codeReviewDiff,
    approvals,
    isLoading,
    error,
    handleApprove,
    handleReject,
    handleCodeReviewApprove,
    handleCodeReviewReject,
    handleRequestChanges,
    handleExpandCodeReview,
    handleBulkApprove,
    toggleSelect,
    toggleSelectAll,
    formatDate,
  } = useApprovalsClient();

  const totalPages = Math.ceil(approvals.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedApprovals = approvals.slice(startIndex, startIndex + itemsPerPage);

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
      {!isLoading && approvals.length > 0 && (
        <div className="space-y-4">
          {/* Select All (pending only) */}
          {filter === 'pending' && (
            <div className="flex items-center gap-3 px-4 py-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
              <CheckboxButton
                checked={selectedIds.size === approvals.length}
                onClick={toggleSelectAll}
              />
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
                  handleCodeReviewApprove(approval.id, commitMessage, baseBranch)
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
                  setExpandedId(expandedId === approval.id ? null : approval.id)
                }
                onApprove={(selected) => handleApprove(approval.id, selected)}
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
      )}
    </div>
  );
}
