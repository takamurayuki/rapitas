'use client';
// useApprovalsClient

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApprovals } from '@/feature/developer-mode/hooks/useApprovals';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';

/**
 * All state and derived helpers needed by ApprovalsClient and its sub-components.
 *
 * NOTE: this page now only handles SUBTASK-decomposition approvals. Code-review
 * approval was removed — a completed execution's PR is opened directly from the
 * task's execution panel instead.
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
  // From useApprovals
  approvals: ReturnType<typeof useApprovals>['approvals'];
  isLoading: boolean;
  error: string | null;
  // Action handlers
  handleApprove: (id: number, selectedSubtasks?: number[]) => Promise<void>;
  handleReject: (id: number) => Promise<void>;
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

  const { approvals, isLoading, error, fetchApprovals, approve, reject, bulkApprove } =
    useApprovals();

  const [filter, setFilter] = useState<string>('pending');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [hasAutoExpanded, setHasAutoExpanded] = useState(false);

  useEffect(() => {
    fetchApprovals(filter);
    setCurrentPage(1);
  }, [filter, fetchApprovals]);

  // Read ID from URL parameter and auto-expand corresponding approval request.
  useEffect(() => {
    if (expandParam && approvals.length > 0 && !hasAutoExpanded) {
      const targetId = parseInt(expandParam, 10);
      if (approvals.some((a) => a.id === targetId)) {
        setExpandedId(targetId);
        setHasAutoExpanded(true);
      }
    }
  }, [expandParam, approvals, hasAutoExpanded]);

  /** Approve a subtask-decomposition request, optionally for a subset of subtasks. */
  const handleApprove = useCallback(
    async (id: number, selectedSubtasks?: number[]) => {
      setProcessingId(id);
      await approve(id, selectedSubtasks);
      setProcessingId(null);
      setExpandedId(null);
    },
    [approve],
  );

  /** Reject a subtask-decomposition request. */
  const handleReject = useCallback(
    async (id: number) => {
      setProcessingId(id);
      await reject(id);
      setProcessingId(null);
      setExpandedId(null);
    },
    [reject],
  );

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
  const formatDate = useCallback(
    (dateString: string) => {
      return new Date(dateString).toLocaleDateString(dateLocale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    },
    [dateLocale],
  );

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
    approvals,
    isLoading,
    error,
    handleApprove,
    handleReject,
    handleBulkApprove,
    toggleSelect,
    toggleSelectAll,
    formatDate,
  };
}
