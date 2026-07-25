'use client';
// AIAccordionPanelInner

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExecutionSection } from './ExecutionSection';
import { useAccordionState } from './useAccordionState';
import { usePromptOptimization } from './usePromptOptimization';
import { useExecutionManager } from './useExecutionManager';
import type { AIAccordionPanelProps } from './types';

/**
 * Full AI accordion panel composed from focused sub-components and hooks.
 * This is the implementation file — the public surface is AIAccordionPanel.tsx.
 *
 * @param props - Complete panel props as defined in AIAccordionPanelProps.
 */
export function AIAccordionPanelInner({
  embedded = false,
  taskId,
  taskTitle,
  taskDescription,
  // NOTE: unused since the analysis/subtask-approval sub-panel was removed; kept as `_`-prefixed
  // because they are required by the shared AIAccordionPanelProps contract.
  config: _config,
  isAnalyzing: _isAnalyzing,
  analysisResult: _analysisResult,
  analysisError: _analysisError,
  analysisApprovalId: _analysisApprovalId,
  onAnalyze: _onAnalyze,
  onApprove: _onApprove,
  onReject: _onReject,
  onApproveSubtasks: _onApproveSubtasks,
  isApproving: _isApproving,
  onOpenSettings: _onOpenSettings,
  onPromptGenerated,
  onSubtasksCreated: _onSubtasksCreated,
  showAgentPanel,
  executionCapability = 'ready',
  themeId,
  isExecuting,
  executionStatus,
  executionResult,
  executionError,
  useTaskAnalysis,
  optimizedPrompt,
  agentConfigId,
  resources,
  agents: _agents,
  onAgentChange: _onAgentChange,
  onExecute,
  onReset,
  onRestoreExecutionState,
  onStopExecution,
  onExecutionComplete,
  subtasks,
  onStartParallelExecution,
  isParallelExecutionRunning,
  getSubtaskStatus,
  parallelSessionId,
  subtaskLogs,
  onRefreshSubtaskLogs,
  taskStatus,
}: AIAccordionPanelProps) {
  const t = useTranslations('devMode.aiAccordionPanelInner');
  // Subtask selection state (lives here to avoid circular deps between hooks)
  // NOTE: only the setters survive — the values themselves are read by the
  // analysis/subtask-approval sub-panel, which was removed from this component.
  const [, setSelectedSubtasks] = useState<number[]>([]);
  const [, setSubtaskCreationSuccess] = useState(false);

  // Accordion / tab state
  const { setExpandedSection } = useAccordionState({
    taskId,
    onTaskChange: () => {
      setSelectedSubtasks([]);
      setSubtaskCreationSuccess(false);
    },
  });

  // Prompt optimization
  // NOTE: return value is unused here (the prompt-optimization sub-panel was removed),
  // but the hook must still run for its internal side effects.
  usePromptOptimization({ taskId, onPromptGenerated });

  // Execution lifecycle
  const exec = useExecutionManager({
    taskId,
    taskTitle,
    taskDescription,
    isExecuting,
    executionStatus,
    executionResult,
    executionError,
    optimizedPrompt,
    agentConfigId,
    resources,
    useTaskAnalysis,
    subtasks,
    isParallelExecutionRunning,
    onExecute,
    onReset,
    onRestoreExecutionState,
    onStopExecution,
    onExecutionComplete,
    onStartParallelExecution,
    setExpandedSection,
  });

  // Derived execution status icon
  const getExecStatusIcon = ():
    | 'loading'
    | 'success'
    | 'error'
    | 'cancelled'
    | 'interrupted'
    | 'idle' => {
    // NOTE: Show idle during state restoration to prevent flash of "running" spinner
    if (exec.isRestoring) return 'idle';
    if (exec.isRunning) return 'loading';
    if (exec.isFailed) return 'error';
    if (exec.isCompleted) return 'success';
    if (exec.isCancelled) return 'cancelled';
    if (exec.isInterrupted) return 'interrupted';
    // NOTE: When the task itself is marked done (not via workflow polling), reflect it as success.
    if (taskStatus === 'done' || taskStatus === 'completed') return 'success';
    return 'idle';
  };

  const hasSubtasks = !!(subtasks && subtasks.length > 0);

  return (
    <div
      className={
        embedded
          ? 'border-t border-zinc-200 dark:border-zinc-700'
          : 'bg-white dark:bg-indigo-dark-900 rounded-lg border border-zinc-200 dark:border-zinc-800 mb-6 overflow-hidden'
      }
      role="region"
      aria-label={t('panelAriaLabel')}
    >
      {showAgentPanel && (
        <ExecutionSection
          capability={executionCapability}
          themeId={themeId}
          taskId={taskId}
          isRunning={exec.isRunning}
          isCompleted={exec.isCompleted}
          isCancelled={exec.isCancelled}
          isFailed={exec.isFailed}
          isInterrupted={exec.isInterrupted}
          isExecuting={isExecuting}
          isParallelExecutionRunning={isParallelExecutionRunning}
          hasSubtasks={hasSubtasks}
          execStatusIcon={getExecStatusIcon()}
          logs={exec.logs}
          showLogs={exec.showLogs}
          logViewerStatus={exec.logViewerStatus}
          isSseConnected={exec.isSseConnected}
          executionError={executionError}
          pollingSessionMode={exec.pollingSessionMode}
          hasQuestion={exec.hasQuestion}
          question={exec.question}
          questionDetails={exec.questionDetails}
          userResponse={exec.userResponse}
          isSendingResponse={exec.isSendingResponse}
          onSetUserResponse={exec.setUserResponse}
          onSendResponse={exec.handleSendResponse}
          subtasks={subtasks}
          subtaskLogs={subtaskLogs}
          parallelSessionId={parallelSessionId}
          getSubtaskStatus={getSubtaskStatus}
          onRefreshSubtaskLogs={onRefreshSubtaskLogs}
          continueInstruction={exec.continueInstruction}
          onSetContinueInstruction={exec.setContinueInstruction}
          onContinueExecution={exec.handleContinueExecution}
          optimizedPrompt={optimizedPrompt}
          instruction={exec.instruction}
          branchName={exec.branchName}
          baseBranch={exec.baseBranch}
          baseBranches={exec.baseBranches}
          isGeneratingBranchName={exec.isGeneratingBranchName}
          onSetInstruction={exec.setInstruction}
          onSetBranchName={exec.setBranchName}
          onSetBaseBranch={exec.setBaseBranch}
          onGenerateBranchName={exec.handleGenerateBranchName}
          onExecute={exec.handleExecute}
          onStop={exec.handleStopExecution}
          onReset={exec.handleReset}
          onRerun={exec.handleRerunExecution}
          taskStatus={taskStatus}
        />
      )}
    </div>
  );
}
