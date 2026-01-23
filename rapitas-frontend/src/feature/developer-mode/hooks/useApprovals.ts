"use client";

import { useState, useCallback } from "react";
import type { ApprovalRequest } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export function useApprovals() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchApprovals = useCallback(async (status?: string) => {
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
        throw new Error("承認リクエストの取得に失敗しました");
      }
    } catch (err: any) {
      setError(err.message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

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
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedSubtasks }),
        });
        if (res.ok) {
          const data = await res.json();
          setApprovals((prev) => prev.filter((a) => a.id !== id));
          return data;
        } else {
          throw new Error("承認に失敗しました");
        }
      } catch (err: any) {
        setError(err.message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const reject = useCallback(async (id: number, reason?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/approvals/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        setApprovals((prev) => prev.filter((a) => a.id !== id));
        return true;
      } else {
        throw new Error("却下に失敗しました");
      }
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const bulkApprove = useCallback(async (ids: number[]) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/approvals/bulk-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        const data = await res.json();
        const approvedIds = data.results
          .filter((r: any) => r.success)
          .map((r: any) => r.id);
        setApprovals((prev) => prev.filter((a) => !approvedIds.includes(a.id)));
        return data;
      } else {
        throw new Error("一括承認に失敗しました");
      }
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

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
