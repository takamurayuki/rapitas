'use client';
// TaskAISection
import { useEffect, useRef } from 'react';
import type { Task, Resource, DeveloperModeConfig } from '@/types';
import { AIAccordionPanel } from '@/feature/developer-mode/components/AIAccordionPanel';
import { API_BASE_URL } from '@/utils/api';
import { clearApiCache } from '@/lib/api-client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('TaskAISection');
const API_BASE = API_BASE_URL;

/** Delay (ms) before polling for auto-execute config after subtask creation. */
const SUBTASK_AUTO_EXECUTE_DELAY_MS = 500;
/** Number of polling attempts when waiting for task status to reach "done". */
const EXECUTION_COMPLETE_MAX_ATTEMPTS = 6;

export interface TaskAISectionProps {
  task: Task;
  taskId: number;
  resolvedTaskId: string;
  devModeConfig: DeveloperModeConfig | null;
  isAnalyzing: boolean;
  analysisResult: unknown;
  analysisError: string | null;
  analysisApprovalId: number | null;
  isExecuting: boolean;
  executionStatus: unknown;
  executionResult: { error?: string | null } | null;
  isParallelExecutionRunning: boolean;
  parallelSessionId: string | null;
  isApproving: boolean;
  optimizedPrompt: string | null;
  resources: Resource[];
  agentConfigId: number | null;
  agents: unknown[];
  subtaskLogs: unknown;
  onOpenSettings: () => void;
  onAnalyze: () => Promise<void>;
  onApprove: (arg?: number | number[]) => Promise<void>;
  onReject: () => Promise<void>;
  onApproveSubtasks: (...args: unknown[]) => unknown;
  onPromptGenerated: (prompt: string) => void;
  onAgentChange: (id: number | null) => void;
  onExecute: (
    options?: unknown,
  ) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
  onRestoreExecutionState: () => Promise<unknown>;
  onStopExecution: (...args: unknown[]) => unknown;
  onStartParallelExecution: () => void;
  getSubtaskStatus: (subtaskId: number) => unknown;
  onRefreshSubtaskLogs: () => void;
  setTask: React.Dispatch<React.SetStateAction<Task | null>>;
  refetchWorkflowFiles: () => void;
  onTaskUpdated?: () => void;
  startSession: () => void;
  /** True while the initial execution status fetch is in progress. */
  isRestoringState?: boolean;
  /** When true, omit the outer card wrapper (used inside a unified container). */
  embedded?: boolean;
}

/**
 * AI panel section for the task detail page, including subtask-creation
 * auto-execute and execution-complete polling logic.
 *
 * @param props - All AI panel state and task-level callbacks.
 */
export default function TaskAISection({
  task,
  taskId,
  resolvedTaskId,
  devModeConfig,
  isAnalyzing,
  analysisResult,
  analysisError,
  analysisApprovalId,
  isExecuting,
  executionStatus,
  executionResult,
  isParallelExecutionRunning,
  parallelSessionId,
  isApproving,
  optimizedPrompt,
  resources,
  agentConfigId,
  agents,
  subtaskLogs,
  onOpenSettings,
  onAnalyze,
  onApprove,
  onReject,
  onApproveSubtasks,
  onPromptGenerated,
  onAgentChange,
  onExecute,
  onReset,
  onRestoreExecutionState,
  onStopExecution,
  onStartParallelExecution,
  getSubtaskStatus,
  onRefreshSubtaskLogs,
  setTask,
  refetchWorkflowFiles,
  onTaskUpdated,
  startSession,
  isRestoringState,
  embedded = false,
}: TaskAISectionProps) {
  // NOTE: Poll for subtask status updates while execution is in progress.
  // Refreshes the parent task every 5 seconds to pick up newly created subtasks
  // and their status changes (todo → in-progress → done).
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (isExecuting || isParallelExecutionRunning) {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
          if (res.ok) {
            const freshTask = await res.json();
            setTask(freshTask);
          }
        } catch {
          /* non-critical */
        }
      }, 5000);
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isExecuting, isParallelExecutionRunning, resolvedTaskId, setTask]);

  // Show skeleton while execution status is being fetched
  if (isRestoringState) {
    const skeleton = (
      <div
        className={
          embedded
            ? 'animate-pulse border-t border-zinc-200 dark:border-zinc-700'
            : 'rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden animate-pulse'
        }
      >
        <div className="px-4 py-2.5 flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800">
          <div className="w-4 h-4 bg-zinc-200 dark:bg-zinc-700 rounded" />
          <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-32" />
        </div>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
            <div className="flex-1 space-y-3">
              <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
              <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-64" />
            </div>
          </div>
        </div>
      </div>
    );
    if (embedded) return skeleton;
    return <div className="mb-6">{skeleton}</div>;
  }

  const handleSubtasksCreated = async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
      if (!res.ok) {
        logger.error('Failed to fetch task after subtask creation');
        return;
      }

      const data = await res.json();
      setTask(data);

      await new Promise((resolve) =>
        setTimeout(resolve, SUBTASK_AUTO_EXECUTE_DELAY_MS),
      );

      try {
        const configRes = await fetch(
          `${API_BASE}/agent-execution-config/${resolvedTaskId}`,
        );
        if (!configRes.ok) {
          logger.warn('Auto-execute config not found');
          return;
        }

        const configData = await configRes.json();
        if (configData.autoExecuteOnAnalysis) {
          if (data.subtasks && data.subtasks.length > 0) {
            logger.debug('Auto-executing parallel tasks after analysis');
            startSession();
          } else {
            if (isExecuting) {
              logger.warn('Skipping auto-execute: already executing');
            } else {
              logger.debug('Auto-executing agent after analysis');
              if (task.status !== 'in-progress') {
                setTask((prev) => {
                  if (!prev) return prev;
                  return { ...prev, status: 'in-progress' };
                });
              }
              await onExecute({
                useTaskAnalysis: true,
                optimizedPrompt: optimizedPrompt || undefined,
                agentConfigId: agentConfigId ?? undefined,
              });
            }
          }
        }
      } catch (err) {
        logger.error('Failed to check auto-execute config:', err);
      }
    } catch (err) {
      logger.error('Error in onSubtasksCreated:', err);
    }
  };

  const handleExecutionComplete = async () => {
    // NOTE: Invalidate cache first so any re-fetch gets fresh data
    clearApiCache(`/tasks/${resolvedTaskId}`);
    for (
      let attempt = 0;
      attempt < EXECUTION_COMPLETE_MAX_ATTEMPTS;
      attempt++
    ) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 1000 : 2000));
      try {
        const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
        if (res.ok) {
          const data = await res.json();
          setTask(data);
          if (data.status === 'done') break;
        }
      } catch {
        /* retry */
      }
    }
    refetchWorkflowFiles();
    onTaskUpdated?.();
  };

  const handleExecute = async (options?: unknown) => {
    if (isExecuting) {
      logger.warn('Skipping execute: already executing');
      return null;
    }
    if (task.status !== 'in-progress') {
      setTask((prev) => {
        if (!prev) return prev;
        return { ...prev, status: 'in-progress' };
      });
    }
    return onExecute(options);
  };

  // NOTE: When embedded, skip the wrapper div — parent handles spacing.
  const content = (
    <AIAccordionPanel
      embedded={embedded}
      taskId={taskId}
      taskTitle={task.title}
      taskDescription={task.description}
      config={devModeConfig}
      onOpenSettings={onOpenSettings}
      isAnalyzing={isAnalyzing}
      // HACK(agent): TaskAISectionProps uses loose `unknown` types for values
      // that originate from zustand selectors. Cast to satisfy AIAccordionPanel
      // until the prop chain is fully typed (ADR-0004 Step 2+).
      analysisResult={
        analysisResult as Parameters<
          typeof AIAccordionPanel
        >[0]['analysisResult']
      }
      analysisError={analysisError}
      analysisApprovalId={analysisApprovalId}
      onAnalyze={onAnalyze}
      onApprove={onApprove}
      onReject={onReject}
      onApproveSubtasks={
        onApproveSubtasks as Parameters<
          typeof AIAccordionPanel
        >[0]['onApproveSubtasks']
      }
      isApproving={isApproving}
      onPromptGenerated={onPromptGenerated}
      onSubtasksCreated={handleSubtasksCreated}
      showAgentPanel={
        devModeConfig?.isEnabled === true || isExecuting || !!executionResult
      }
      isExecuting={isExecuting}
      executionStatus={
        executionStatus as Parameters<
          typeof AIAccordionPanel
        >[0]['executionStatus']
      }
      executionResult={
        executionResult as Parameters<
          typeof AIAccordionPanel
        >[0]['executionResult']
      }
      executionError={executionResult?.error || null}
      workingDirectory={task.theme?.workingDirectory || undefined}
      defaultBranch={task.theme?.defaultBranch || 'main'}
      useTaskAnalysis={!!analysisResult}
      optimizedPrompt={optimizedPrompt}
      resources={resources}
      agentConfigId={agentConfigId}
      agents={agents as Parameters<typeof AIAccordionPanel>[0]['agents']}
      onAgentChange={onAgentChange}
      onExecute={handleExecute}
      onReset={onReset}
      onRestoreExecutionState={
        onRestoreExecutionState as Parameters<
          typeof AIAccordionPanel
        >[0]['onRestoreExecutionState']
      }
      onStopExecution={onStopExecution}
      onExecutionComplete={handleExecutionComplete}
      subtasks={task.subtasks}
      onStartParallelExecution={
        onStartParallelExecution as Parameters<
          typeof AIAccordionPanel
        >[0]['onStartParallelExecution']
      }
      isParallelExecutionRunning={isParallelExecutionRunning}
      getSubtaskStatus={
        getSubtaskStatus as Parameters<
          typeof AIAccordionPanel
        >[0]['getSubtaskStatus']
      }
      parallelSessionId={parallelSessionId}
      subtaskLogs={
        subtaskLogs as Parameters<typeof AIAccordionPanel>[0]['subtaskLogs']
      }
      onRefreshSubtaskLogs={onRefreshSubtaskLogs}
    />
  );

  return content;
}
