import React, { useEffect, useState } from 'react';
import type { Task } from '@/types';
import type { WorkflowStatus } from '@/types';
import WorkflowViewer from '@/components/workflow/WorkflowViewer';
import WorkflowStatusIndicator from '@/components/workflow/WorkflowStatusIndicator';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';

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

  // Compute the *effective* auto-approve state by OR-ing the task-level flag
  // with the global UserSettings entries — matches the backend rule in
  // `_handlePlanAutoApprove`. Without this the indicator showed OFF when only
  // the global setting was on.
  const [globalAutoApprove, setGlobalAutoApprove] = useState<{
    autoApprovePlan: boolean;
    autoApproveSubtaskPlan: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/settings`);
        if (!res.ok) return;
        const settings = await res.json();
        if (cancelled) return;
        setGlobalAutoApprove({
          autoApprovePlan: !!settings.autoApprovePlan,
          autoApproveSubtaskPlan: !!settings.autoApproveSubtaskPlan,
        });
      } catch {
        // Non-fatal — fall back to task-level only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isSubtask = !!task?.parentId;
  const taskFlag = !!task?.autoApprovePlan;
  const globalFlag = !!globalAutoApprove?.autoApprovePlan;
  const subtaskGlobalFlag = isSubtask && !!globalAutoApprove?.autoApproveSubtaskPlan;
  const effectiveAutoApprove = taskFlag || globalFlag || subtaskGlobalFlag;
  const autoApproveSource: 'task' | 'global' | 'subtask-global' | undefined = taskFlag
    ? 'task'
    : globalFlag
      ? 'global'
      : subtaskGlobalFlag
        ? 'subtask-global'
        : undefined;

  const MODE_LABELS: Record<string, string> = {
    lightweight: '軽量',
    standard: '標準',
    comprehensive: '詳細',
  };
  const complexity = task?.complexityScore;
  const modeLabel = task?.workflowMode ? (MODE_LABELS[task.workflowMode] ?? '') : '';

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-lg border border-zinc-200 dark:border-zinc-800 mb-6">
      <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h3>
            <WorkflowStatusIndicator status={currentWorkflowStatus} size="sm" />
          </div>
          <div className="flex items-center gap-2">
            {complexity != null && (
              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                複雑度 {Math.round(complexity)}
                {modeLabel ? ` · ${modeLabel}` : ''}
              </span>
            )}
            <span
              className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                effectiveAutoApprove
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
              title={`計画自動承認: ${effectiveAutoApprove ? 'ON（plan.md 保存で自動進行）' : 'OFF（手動承認が必要）'}`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${effectiveAutoApprove ? 'bg-emerald-500' : 'bg-zinc-400'}`}
              />
              自動承認 {effectiveAutoApprove ? 'ON' : 'OFF'}
            </span>
            <Loader2
              className={`h-4 w-4 text-zinc-400 animate-spin transition-opacity ${isWorkflowLoading ? 'opacity-100' : 'opacity-0'}`}
            />
          </div>
        </div>
      </div>

      <WorkflowViewer
        taskId={taskId}
        workflowStatus={currentWorkflowStatus}
        workflowMode={task?.workflowMode}
        complexityScore={task?.complexityScore}
        workflowModeOverride={task?.workflowModeOverride ?? undefined}
        autoApprovePlan={effectiveAutoApprove}
        autoApprovePlanSource={autoApproveSource}
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
        // NOTE: autoApprovePlan is read-only here — the workflow tab only
        // displays the current value. Editing happens via the task settings
        // page so the UX matches the "状態表示だけ" policy.
        showWorkflowMode={true}
      />

      {workflowError && (
        <div className="px-4 pb-4">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <p className="text-sm text-red-700 dark:text-red-300">{workflowError}</p>
          </div>
        </div>
      )}
    </div>
  );
}
