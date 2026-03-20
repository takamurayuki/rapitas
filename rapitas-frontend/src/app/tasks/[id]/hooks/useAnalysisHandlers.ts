/**
 * useAnalysisHandlers
 *
 * Manages task analysis approval flow: initiates analysis, approves or
 * rejects the resulting approval request, and refreshes task data.
 * Not responsible for developer mode configuration — that stays in useDeveloperMode.
 */

import { useState } from 'react';
import type { Task } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useAnalysisHandlers');
const API_BASE = API_BASE_URL;

export interface UseAnalysisHandlersParams {
  resolvedTaskId: string | null | undefined;
  setTask: React.Dispatch<React.SetStateAction<Task | null>>;
  analyzeTask: () => Promise<{ approvalRequestId?: number; autoApproved?: boolean } | null | undefined>;
  setAnalysisResult: (result: null) => void;
  approveRequest: (
    id: number,
    selectedSubtasks?: number[],
  ) => Promise<{ success?: boolean } | null | undefined>;
  rejectRequest: (id: number) => Promise<unknown>;
}

export interface UseAnalysisHandlersResult {
  pendingApprovalId: number | null;
  optimizedPrompt: string | null;
  setOptimizedPrompt: React.Dispatch<React.SetStateAction<string | null>>;
  handleAnalyze: () => Promise<void>;
  handleApproveAnalysis: (arg?: number | number[]) => Promise<void>;
  handleRejectAnalysis: () => Promise<void>;
}

/**
 * Provides analysis initiation and approval/rejection handlers.
 *
 * @param params - Developer mode actions and task state setters.
 * @returns Handlers and related state for the analysis approval flow.
 */
export function useAnalysisHandlers({
  resolvedTaskId,
  setTask,
  analyzeTask,
  setAnalysisResult,
  approveRequest,
  rejectRequest,
}: UseAnalysisHandlersParams): UseAnalysisHandlersResult {
  const [pendingApprovalId, setPendingApprovalId] = useState<number | null>(null);
  const [optimizedPrompt, setOptimizedPrompt] = useState<string | null>(null);

  const handleAnalyze = async () => {
    const result = await analyzeTask();
    if (result?.approvalRequestId) {
      setPendingApprovalId(result.approvalRequestId);
    }
    if (result?.autoApproved) {
      const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
      if (res.ok) setTask(await res.json());
    }
  };

  const handleApproveAnalysis = async (arg?: number | number[]) => {
    const approvalId = typeof arg === 'number' ? arg : pendingApprovalId;
    const selectedSubtasks = Array.isArray(arg) ? arg : undefined;
    if (!approvalId) return;
    const result = await approveRequest(approvalId, selectedSubtasks);
    if (result?.success) {
      setAnalysisResult(null);
      setPendingApprovalId(null);
      const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
      if (res.ok) setTask(await res.json());
    }
  };

  const handleRejectAnalysis = async () => {
    if (!pendingApprovalId) return;
    await rejectRequest(pendingApprovalId);
    setAnalysisResult(null);
    setPendingApprovalId(null);
  };

  return {
    pendingApprovalId,
    optimizedPrompt,
    setOptimizedPrompt,
    handleAnalyze,
    handleApproveAnalysis,
    handleRejectAnalysis,
  };
}
