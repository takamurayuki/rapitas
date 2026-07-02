/**
 * useWorkflowHandlers
 *
 * Manages plan-approval callbacks for the task detail page. Handles polling to
 * restore execution state after approval.
 * Not responsible for fetching workflow files — that is owned by useWorkflowFiles.
 */

import { useState, useEffect, useCallback } from 'react';
import type { WorkflowStatus } from '@/types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useWorkflowHandlers');

/** Interval (ms) between execution-state restore polls after plan approval. */
const RESTORE_POLL_INTERVAL_MS = 2000;
/** Maximum poll attempts before giving up on execution state restore. */
const RESTORE_MAX_ATTEMPTS = 10;

export interface UseWorkflowHandlersParams {
  taskId: number;
  workflowStatus: WorkflowStatus | null | undefined;
  refetchWorkflowFiles: () => void;
  restoreExecutionState: () => Promise<{ status?: string } | null | undefined>;
  onTaskUpdated?: () => void;
}

export interface UseWorkflowHandlersResult {
  currentWorkflowStatus: WorkflowStatus | null;
  setCurrentWorkflowStatus: React.Dispatch<React.SetStateAction<WorkflowStatus | null>>;
  showPlanApprovalModal: boolean;
  closePlanApprovalModal: () => void;
  handlePlanApprovalRequest: () => void;
  handleApprovalComplete: (approved: boolean, newStatus?: string) => void;
}

/**
 * Provides workflow approval and completion handlers for the task detail page.
 *
 * @param params - Dependencies including taskId, status, and refetch callbacks.
 * @returns Modal visibility state and handler functions.
 */
export function useWorkflowHandlers({
  taskId: _taskId,
  workflowStatus,
  refetchWorkflowFiles,
  restoreExecutionState,
  onTaskUpdated,
}: UseWorkflowHandlersParams): UseWorkflowHandlersResult {
  const [currentWorkflowStatus, setCurrentWorkflowStatus] = useState<WorkflowStatus | null>(null);
  const [showPlanApprovalModal, setShowPlanApprovalModal] = useState(false);

  // Sync external workflow status into local state when it changes
  useEffect(() => {
    if (workflowStatus && workflowStatus !== currentWorkflowStatus) {
      setCurrentWorkflowStatus(workflowStatus);
    }
  }, [workflowStatus]);

  const handlePlanApprovalRequest = useCallback(() => {
    setShowPlanApprovalModal(true);
  }, []);

  const handleApprovalComplete = useCallback(
    (approved: boolean, newStatus?: string) => {
      if (approved && newStatus) {
        setCurrentWorkflowStatus(newStatus as WorkflowStatus);
        onTaskUpdated?.();

        // NOTE: Poll to restore execution state after approval — backend needs time to start the agent.
        let attempts = 0;

        const tryRestoreExecution = async () => {
          attempts++;
          try {
            const result = await restoreExecutionState();
            if (result && result.status === 'running') {
              logger.debug('Execution state restored after approval');
              return;
            }
            if (attempts < RESTORE_MAX_ATTEMPTS) {
              setTimeout(tryRestoreExecution, RESTORE_POLL_INTERVAL_MS);
            }
          } catch (err) {
            logger.warn('Failed to restore execution state:', err);
            if (attempts < RESTORE_MAX_ATTEMPTS) {
              setTimeout(tryRestoreExecution, RESTORE_POLL_INTERVAL_MS);
            }
          }
        };

        setTimeout(tryRestoreExecution, 1000);
      }
      refetchWorkflowFiles();
      setShowPlanApprovalModal(false);
    },
    [onTaskUpdated, refetchWorkflowFiles, restoreExecutionState],
  );

  // NOTE: handleWorkflowComplete (the manual "実装完了" force-complete) was
  // removed — verification auto-completes the task on success, and forcing
  // completion bypassed the completion/verification gate and skipped commit/PR.

  return {
    currentWorkflowStatus,
    setCurrentWorkflowStatus,
    showPlanApprovalModal,
    closePlanApprovalModal: () => setShowPlanApprovalModal(false),
    handlePlanApprovalRequest,
    handleApprovalComplete,
  };
}
