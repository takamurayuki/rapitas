/**
 * TaskAISection
 *
 * Wraps AIAccordionPanel with task-detail-specific handlers for subtask
 * creation, agent execution, execution completion, and parallel execution.
 * All fetch calls that update local task state use callback props so this
 * component remains stateless with respect to the task object itself.
 */

'use client';
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
  parallelSessionId: number | null;
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
  onExecute: (options?: unknown) => Promise<{ sessionId?: number; message?: string } | null>;
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
}: TaskAISectionProps) {
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
    for (let attempt = 0; attempt < EXECUTION_COMPLETE_MAX_ATTEMPTS; attempt++) {
      await new Promise((r) =>
        setTimeout(r, attempt === 0 ? 1000 : 2000),
      );
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

  return (
    <div className="mb-6">
      <AIAccordionPanel
        taskId={taskId}
        taskTitle={task.title}
        taskDescription={task.description}
        config={devModeConfig}
        onOpenSettings={onOpenSettings}
        isAnalyzing={isAnalyzing}
        analysisResult={analysisResult}
        analysisError={analysisError}
        analysisApprovalId={analysisApprovalId}
        onAnalyze={onAnalyze}
        onApprove={onApprove}
        onReject={onReject}
        onApproveSubtasks={onApproveSubtasks}
        isApproving={isApproving}
        onPromptGenerated={onPromptGenerated}
        onSubtasksCreated={handleSubtasksCreated}
        showAgentPanel={devModeConfig?.isEnabled === true}
        isExecuting={isExecuting}
        executionStatus={executionStatus}
        executionResult={executionResult}
        executionError={executionResult?.error || null}
        workingDirectory={task.theme?.workingDirectory || undefined}
        defaultBranch={task.theme?.defaultBranch || 'main'}
        useTaskAnalysis={!!analysisResult}
        optimizedPrompt={optimizedPrompt}
        resources={resources}
        agentConfigId={agentConfigId}
        agents={agents}
        onAgentChange={onAgentChange}
        onExecute={handleExecute}
        onReset={onReset}
        onRestoreExecutionState={onRestoreExecutionState}
        onStopExecution={onStopExecution}
        onExecutionComplete={handleExecutionComplete}
        subtasks={task.subtasks}
        onStartParallelExecution={onStartParallelExecution}
        isParallelExecutionRunning={isParallelExecutionRunning}
        getSubtaskStatus={getSubtaskStatus}
        parallelSessionId={parallelSessionId}
        subtaskLogs={subtaskLogs}
        onRefreshSubtaskLogs={onRefreshSubtaskLogs}
      />
    </div>
  );
}
