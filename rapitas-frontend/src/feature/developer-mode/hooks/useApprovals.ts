'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { ApprovalRequest } from '@/types';
import { API_BASE_URL } from '@/utils/api';

export function useApprovals() {
  const t = useTranslations('devMode.useApprovals');
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchApprovals = useCallback(
    async (status?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const url = status
          ? `${API_BASE_URL}/approvals?status=${status}`
          : `${API_BASE_URL}/approvals`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setApprovals(data);
          return data;
        } else {
          throw new Error(t('fetchFailed'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('genericError'));
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [t],
  );

  const fetchApproval = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/approvals/${id}`);
      if (res.ok) {
        return await res.json();
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const approve = useCallback(
    async (id: number, selectedSubtasks?: number[]) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/approvals/${id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectedSubtasks }),
        });
        if (res.ok) {
          const data = await res.json();
          setApprovals((prev) => prev.filter((a) => a.id !== id));
          return data;
        } else {
          throw new Error(t('approveFailed'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('genericError'));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [t],
  );

  const reject = useCallback(
    async (id: number, reason?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/approvals/${id}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });
        if (res.ok) {
          setApprovals((prev) => prev.filter((a) => a.id !== id));
          return true;
        } else {
          throw new Error(t('rejectFailed'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('genericError'));
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [t],
  );

  const bulkApprove = useCallback(
    async (ids: number[]) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/approvals/bulk-approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        if (res.ok) {
          const data = await res.json();
          const approvedIds = data.results
            .filter((r: { success: boolean; id: number }) => r.success)
            .map((r: { success: boolean; id: number }) => r.id);
          setApprovals((prev) => prev.filter((a) => !approvedIds.includes(a.id)));
          return data;
        } else {
          throw new Error(t('bulkApproveFailed'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('genericError'));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [t],
  );

  return {
    approvals,
    isLoading,
    error,
    fetchApprovals,
    fetchApproval,
    approve,
    reject,
    bulkApprove,
  };
}
