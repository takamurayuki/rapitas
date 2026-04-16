'use client';
// useAgentExecutionHandlers

import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ExecutionResult } from '../../hooks/useDeveloperMode';
import { API_BASE_URL } from '@/utils/api';
import type { PrState } from './agent-execution-types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useAgentExecutionHandlers');

/** Shared state injected from useAgentExecution. */
export type SharedExecutionState = {
  taskId: number;
  sessionId: number | null;
  setSessionId: (id: number | null) => void;
  isExecuting: boolean;
  executionResult: ExecutionResult | null;
  instruction: string;
  branchName: string;
  selectedAgentId: number | null;
  agentConfigId: number | null | undefined;
  useTaskAnalysis: boolean | undefined;
  optimizedPrompt: string | null | undefined;
  followUpInstruction: string;
  setFollowUpInstruction: (v: string) => void;
  setFollowUpError: (v: string | null) => void;
  userResponse: string;
  setUserResponse: (v: string) => void;
  isSendingResponse: boolean;
  setIsSendingResponse: (v: boolean) => void;
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    useTaskAnalysis?: boolean;
    optimizedPrompt?: string;
    agentConfigId?: number;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
  onStopExecution?: () => void;
  startPolling: (options?: {
    initialOutput?: string;
    preserveLogs?: boolean;
    terminalGraceMs?: number;
  }) => void;
  stopPolling: () => void;
  clearPollingLogs: () => void;
  clearSseLogs: () => void;
  setPollingCancelled: () => void;
  clearPollingQuestion: () => void;
  setPrState: Dispatch<SetStateAction<PrState>>;
  hasRestoredRef: React.MutableRefObject<boolean>;
  _setShowLogs: (v: boolean) => void;
};

export type AgentExecutionHandlers = {
  handleExecute: () => Promise<void>;
  handleFollowUpExecute: () => Promise<void>;
  handleSendResponse: () => Promise<void>;
  handleStopExecution: () => Promise<void>;
  handleReset: () => void;
  handleCreatePR: () => Promise<void>;
  handleApproveMerge: () => Promise<void>;
};

/**
 * Returns all event handlers needed by AgentExecutionPanel sub-components.
 *
 * @param s - Shared state object from useAgentExecution
 * @returns Object containing all handler functions
 */
export function useAgentExecutionHandlers(
  s: SharedExecutionState,
): AgentExecutionHandlers {
  const sendingResponseRef = useRef(false);

  const handleExecute = async () => {
    s.clearPollingLogs();
    s.clearSseLogs();
    const result = await s.onExecute({
      instruction: s.instruction.trim() || undefined,
      branchName: s.branchName.trim() || undefined,
      useTaskAnalysis: s.useTaskAnalysis,
      optimizedPrompt: s.optimizedPrompt || undefined,
      agentConfigId: s.selectedAgentId ?? s.agentConfigId ?? undefined,
    });
    if (result?.sessionId) {
      s._setShowLogs(true);
    }
  };

  const handleFollowUpExecute = async () => {
    const trimmedInstruction = s.followUpInstruction.trim();
    if (!trimmedInstruction) return;

    const savedInstruction = trimmedInstruction;
    s.setFollowUpInstruction('');
    s.setFollowUpError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/tasks/${s.taskId}/continue-execution`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instruction: trimmedInstruction,
            sessionId: s.sessionId || s.executionResult?.sessionId,
            agentConfigId: s.selectedAgentId ?? s.agentConfigId,
          }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        if (data.sessionId) {
          s.setSessionId(data.sessionId);
        }
        // NOTE: clearLogs() intentionally omitted to preserve log continuity
        // NOTE: On continuation, the backend may still return the old execution's
        // completed status until a new execution is created, so add a grace period
        setTimeout(() => {
          s.startPolling({ preserveLogs: true, terminalGraceMs: 3000 });
        }, 500);
        s._setShowLogs(true);
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: '継続実行に失敗しました' }));
        logger.error('Failed to continue execution:', errorData);
        s.setFollowUpError(
          errorData.error || '継続実行に失敗しました。再度お試しください。',
        );
        s.setFollowUpInstruction(savedInstruction);
      }
    } catch (err) {
      logger.error('Error continuing execution:', err);
      s.setFollowUpError(
        'サーバーとの通信に失敗しました。再度お試しください。',
      );
      s.setFollowUpInstruction(savedInstruction);
    }
  };

  const handleSendResponse = async () => {
    const trimmedResponse = s.userResponse.trim();
    if (!trimmedResponse || s.isSendingResponse || sendingResponseRef.current)
      return;

    // Set ref immediately to prevent duplicate submissions
    sendingResponseRef.current = true;
    s.setIsSendingResponse(true);

    const savedResponse = trimmedResponse;
    s.setUserResponse('');

    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${s.taskId}/agent-respond`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response: savedResponse }),
        },
      );

      if (res.ok) {
        // NOTE: Clear question UI after API success (optimistic update removed)
        s.clearPollingQuestion();
      } else {
        logger.error('Failed to send response:', res.status);
        s.setUserResponse(savedResponse);
      }
    } catch (err) {
      logger.error('Error sending response:', err);
      s.setUserResponse(savedResponse);
    } finally {
      s.setIsSendingResponse(false);
      sendingResponseRef.current = false;
    }
  };

  const handleStopExecution = useCallback(async () => {
    // Immediately update UI to cancelled state for quick user feedback
    s.setPollingCancelled();
    s.clearPollingLogs();
    s.clearSseLogs();
    s.onStopExecution?.();

    try {
      // Use task-level stop endpoint (more reliable)
      const res = await fetch(
        `${API_BASE_URL}/tasks/${s.taskId}/stop-execution`,
        { method: 'POST' },
      );

      if (!res.ok && s.sessionId) {
        // Fall back to session-level stop on failure
        const fallbackRes = await fetch(
          `${API_BASE_URL}/agents/sessions/${s.sessionId}/stop`,
          { method: 'POST' },
        );
        if (!fallbackRes.ok) {
          logger.error('Failed to stop execution');
        }
      }
    } catch (err) {
      logger.error('Error stopping execution:', err);
    }
    // NOTE: useCallback deps are the primitive values extracted from s; s itself changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.taskId, s.sessionId]);

  const handleReset = async () => {
    s.stopPolling();
    s.clearPollingLogs();
    s.clearSseLogs();
    s.setSessionId(null);
    // NOTE: Allow restoration on next mount
    s.hasRestoredRef.current = false;
    s.setPrState({ status: 'idle' });
    // NOTE: onReset calls resetExecutionState which POSTs to API and resets task to 'todo'.
    // Do NOT call onExecutionComplete here — it has "wait for done" retry logic
    // that conflicts with reset-to-todo intent.
    await Promise.resolve(s.onReset());
  };

  /** Create a PR for this task's branch. */
  const handleCreatePR = async () => {
    s.setPrState({ status: 'creating_pr' });
    try {
      const res = await fetch(
        `${API_BASE_URL}/parallel/tasks/${s.taskId}/create-pr`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseBranch: 'develop' }),
        },
      );
      const data = await res.json();
      if (data.success) {
        s.setPrState({
          status: 'pr_created',
          prUrl: data.data.prUrl,
          prNumber: data.data.prNumber,
        });
      } else {
        s.setPrState({ status: 'error', error: data.error });
      }
    } catch (err) {
      s.setPrState({
        status: 'error',
        error: err instanceof Error ? err.message : 'PR作成に失敗しました',
      });
    }
  };

  /** Approve and merge the PR, then update local develop. */
  const handleApproveMerge = async () => {
    s.setPrState((prev: PrState) => ({ ...prev, status: 'merging' }));
    try {
      const res = await fetch(
        `${API_BASE_URL}/parallel/tasks/${s.taskId}/approve-merge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      const data = await res.json();
      if (data.success) {
        s.setPrState((prev: PrState) => ({ ...prev, status: 'merged' }));
      } else {
        s.setPrState((prev: PrState) => ({
          ...prev,
          status: 'error',
          error: data.error,
        }));
      }
    } catch (err) {
      s.setPrState((prev: PrState) => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : 'マージに失敗しました',
      }));
    }
  };

  return {
    handleExecute,
    handleFollowUpExecute,
    handleSendResponse,
    handleStopExecution,
    handleReset,
    handleCreatePR,
    handleApproveMerge,
  };
}
