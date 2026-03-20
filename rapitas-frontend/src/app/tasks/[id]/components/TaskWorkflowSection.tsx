import React from 'react';
import type { Task } from '@/types';
import type { WorkflowStatus } from '@/types';
import WorkflowViewer from '@/components/workflow/WorkflowViewer';
import WorkflowStatusIndicator, {
  WorkflowProgress,
} from '@/components/workflow/WorkflowStatusIndicator';
import { Loader2 } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useTranslations } from 'next-intl';

const logger = createLogger('TaskWorkflowSection');
const API_BASE = API_BASE_URL;

export interface TaskWorkflowSectionProps {
  task: Task;
  taskId: number;
  currentWorkflowStatus: WorkflowStatus | null;
  setCurrentWorkflowStatus: (status: WorkflowStatus) => void;
  isWorkflowLoading: boolean;
  workflowError: string | null | undefined;
  onPlanApprovalRequest: () => void;
  onWorkflowComplete: () => Promise<void>;
  onTaskUpdated?: () => void;
  setTask: React.Dispatch<React.SetStateAction<Task | null>>;
}

/**
 * Workflow section component for development theme tasks.
 * Displays workflow status, progress, viewer, and error states.
 */
export default function TaskWorkflowSection({
  task,
  taskId,
  currentWorkflowStatus,
  setCurrentWorkflowStatus,
  isWorkflowLoading,
  workflowError,
  onPlanApprovalRequest,
  onWorkflowComplete,
  onTaskUpdated,
  setTask,
}: TaskWorkflowSectionProps) {
  const t = useTranslations('workflow');
  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden mb-6">
      <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {t('title')}
            </h3>
            <WorkflowStatusIndicator status={currentWorkflowStatus} size="sm" />
          </div>
          <Loader2
            className={`h-4 w-4 text-zinc-400 animate-spin transition-opacity ${isWorkflowLoading ? 'opacity-100' : 'opacity-0'}`}
          />
        </div>
        {currentWorkflowStatus && (
          <div className="mt-3">
            <WorkflowProgress currentStatus={currentWorkflowStatus} />
          </div>
        )}
      </div>

      <WorkflowViewer
        taskId={taskId}
        workflowStatus={currentWorkflowStatus}
        workflowMode={task?.workflowMode}
        complexityScore={task?.complexityScore}
        workflowModeOverride={task?.workflowModeOverride ?? undefined}
        autoApprovePlan={task?.autoApprovePlan ?? false}
        onPlanApprovalRequest={onPlanApprovalRequest}
        onCompleteRequest={onWorkflowComplete}
        onStatusChange={(newStatus) => {
          setCurrentWorkflowStatus(newStatus);
          if (onTaskUpdated) onTaskUpdated();
        }}
        onWorkflowModeChange={(mode, isOverride) => {
          if (task) {
            setTask((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                workflowMode: mode,
                workflowModeOverride: isOverride,
              };
            });
            if (onTaskUpdated) onTaskUpdated();
          }
        }}
        onAutoApprovePlanChange={async (value) => {
          if (!task) return;

          try {
            const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ autoApprovePlan: value }),
            });

            if (response.ok) {
              setTask((prev) => {
                if (!prev) return prev;
                return { ...prev, autoApprovePlan: value };
              });
              if (onTaskUpdated) onTaskUpdated();
            } else {
              logger.error('Failed to update autoApprovePlan setting');
            }
          } catch (error) {
            logger.error('Error updating autoApprovePlan setting:', error);
          }
        }}
        showWorkflowMode={true}
      />

      {workflowError && (
        <div className="px-4 pb-4">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <p className="text-sm text-red-700 dark:text-red-300">
              {workflowError}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
