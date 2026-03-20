/**
 * useApprovalsClient
 *
 * Encapsulates all local UI state and action handlers for the approvals page.
 * Data-fetching delegates to the useApprovals feature hook; this hook owns
 * selection, expansion, pagination, and code-review diff caching.
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApprovals } from '@/feature/developer-mode/hooks/useApprovals';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { FileDiff } from '@/types';

const logger = createLogger('useApprovalsClient');

/**
 * All state and derived helpers needed by ApprovalsClient and its sub-components.
 */
export interface ApprovalsClientState {
  filter: string;
  setFilter: (f: string) => void;
  selectedIds: Set<number>;
  processingId: number | null;
  expandedId: number | null;
  currentPage: number;
  setCurrentPage: (p: number) => void;
  itemsPerPage: number;
  setItemsPerPage: (n: number) => void;
  codeReviewDiff: Map<number, FileDiff[]>;
  // From useApprovals
  approvals: ReturnType<typeof useApprovals>['approvals'];
  isLoading: boolean;
  error: string | null;
  // Action handlers
  handleApprove: (id: number, selectedSubtasks?: number[]) => Promise<void>;
  handleReject: (id: number) => Promise<void>;
  handleCodeReviewApprove: (id: number, commitMessage: string, baseBranch: string) => Promise<void>;
  handleCodeReviewReject: (id: number) => Promise<void>;
  handleRequestChanges: (
    id: number,
    feedback: string,
    comments: { file?: string; content: string; type: string }[],
  ) => Promise<void>;
  handleExpandCodeReview: (id: number) => Promise<void>;
  handleBulkApprove: () => Promise<void>;
  toggleSelect: (id: number) => void;
  toggleSelectAll: () => void;
  formatDate: (dateString: string) => string;
  setExpandedId: (id: number | null) => void;
}

/**
 * Manages approvals page state including filter, selection, expansion and pagination.
 *
 * @returns ApprovalsClientState for use in ApprovalsClient
 */
export function useApprovalsClient(): ApprovalsClientState {
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
  const [codeReviewDiff, setCodeReviewDiff] = useState<Map<number, FileDiff[]>>(new Map());
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

        if (
          targetApproval.requestType === 'code_review' &&
          !codeReviewDiff.has(targetId)
        ) {
          if (targetApproval.proposedChanges?.structuredDiff?.length) {
            setCodeReviewDiff((prev) =>
              new Map(prev).set(targetId, targetApproval.proposedChanges.structuredDiff!),
            );
          } else {
            fetchDiff(targetId).then((files) => {
              setCodeReviewDiff((prev) => new Map(prev).set(targetId, files));
            });
          }
        }
      }
    }
  }, [expandParam, approvals, hasAutoExpanded, filter, codeReviewDiff, fetchDiff]);

  /** Approve a subtask-decomposition request, optionally for a subset of subtasks. */
  const handleApprove = useCallback(async (id: number, selectedSubtasks?: number[]) => {
    setProcessingId(id);
    await approve(id, selectedSubtasks);
    setProcessingId(null);
    setExpandedId(null);
  }, [approve]);

  /** Reject a subtask-decomposition request. */
  const handleReject = useCallback(async (id: number) => {
    setProcessingId(id);
    await reject(id);
    setProcessingId(null);
    setExpandedId(null);
  }, [reject]);

  /** Approve a code review request, creating a commit with the given message and branch. */
  const handleCodeReviewApprove = useCallback(async (
    id: number,
    commitMessage: string,
    baseBranch: string,
  ) => {
    setProcessingId(id);
    await approveCodeReview(id, commitMessage, baseBranch);
    setProcessingId(null);
    setExpandedId(null);
  }, [approveCodeReview]);

  /** Reject a code review request. */
  const handleCodeReviewReject = useCallback(async (id: number) => {
    setProcessingId(id);
    await rejectCodeReview(id);
    setProcessingId(null);
    setExpandedId(null);
  }, [rejectCodeReview]);

  /**
   * Send a change-request feedback for a code review.
   *
   * @param id - Approval request ID / <承認リクエストID>
   * @param feedback - Overall feedback text / <フィードバックテキスト>
   * @param comments - Per-file inline comments / <ファイルごとのコメント>
   */
  const handleRequestChanges = useCallback(async (
    id: number,
    feedback: string,
    comments: { file?: string; content: string; type: string }[],
  ) => {
    setProcessingId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/approvals/${id}/request-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback, comments }),
      });
      if (res.ok) {
        await fetchApprovals(filter);
      }
    } catch (err) {
      logger.error('Failed to request changes:', err);
    } finally {
      setProcessingId(null);
      setExpandedId(null);
    }
  }, [fetchApprovals, filter]);

  /**
   * Toggle expansion of a code review card, fetching its diff on first open.
   *
   * @param id - Approval request ID / <承認リクエストID>
   */
  const handleExpandCodeReview = useCallback(async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      if (!codeReviewDiff.has(id)) {
        const approval = approvals.find((a) => a.id === id);
        if (approval?.proposedChanges?.structuredDiff?.length) {
          setCodeReviewDiff((prev) =>
            new Map(prev).set(id, approval.proposedChanges.structuredDiff!),
          );
        } else {
          const files = await fetchDiff(id);
          setCodeReviewDiff((prev) => new Map(prev).set(id, files));
        }
      }
    }
  }, [expandedId, codeReviewDiff, approvals, fetchDiff]);

  /** Approve all currently selected approval requests. */
  const handleBulkApprove = useCallback(async () => {
    if (selectedIds.size === 0) return;
    await bulkApprove(Array.from(selectedIds));
    setSelectedIds(new Set());
  }, [selectedIds, bulkApprove]);

  /** Toggle individual row selection. */
  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /** Select all or deselect when all are already selected. */
  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === approvals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(approvals.map((a) => a.id)));
    }
  }, [selectedIds.size, approvals]);

  /**
   * Format an ISO date string according to the user's locale.
   *
   * @param dateString - ISO 8601 date string / <ISO 8601形式の日時文字列>
   * @returns Formatted date string / <フォーマットされた日時文字列>
   */
  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString(dateLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [dateLocale]);

  return {
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
  };
}
