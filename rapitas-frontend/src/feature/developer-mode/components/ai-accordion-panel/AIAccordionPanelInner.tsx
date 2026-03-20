/**
 * AIAccordionPanelInner
 *
 * Assembles hooks and sub-components into the complete AI accordion panel.
 * Wires useAccordionState, usePromptOptimization, and useExecutionManager
 * together and delegates rendering to PanelHeader, AnalysisSection, and
 * ExecutionSection.
 */

'use client';

import { useState, useCallback } from 'react';
import { PanelHeader } from './PanelHeader';
import { AnalysisSection } from './AnalysisSection';
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
  taskId,
  taskTitle,
  taskDescription,
  config,
  isAnalyzing,
  analysisResult,
  analysisError,
  analysisApprovalId,
  onAnalyze,
  onApprove,
  onReject,
  onApproveSubtasks,
  isApproving,
  onOpenSettings,
  onPromptGenerated,
  onSubtasksCreated,
  showAgentPanel,
  isExecuting,
  executionStatus,
  executionResult,
  executionError,
  useTaskAnalysis,
  optimizedPrompt,
  agentConfigId,
  resources,
  agents,
  onAgentChange,
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
}: AIAccordionPanelProps) {
  // Subtask selection state (lives here to avoid circular deps between hooks)
  const [selectedSubtasks, setSelectedSubtasks] = useState<number[]>([]);
  const [isCreatingSubtasks, setIsCreatingSubtasks] = useState(false);
  const [subtaskCreationSuccess, setSubtaskCreationSuccess] = useState(false);

  // Accordion / tab state
  const { expandedSection, setExpandedSection, toggleSection, analysisTab, setAnalysisTab } =
    useAccordionState({
      taskId,
      onTaskChange: () => {
        setSelectedSubtasks([]);
        setSubtaskCreationSuccess(false);
      },
    });

  // Prompt optimization
  const {
    isGeneratingPrompt,
    promptResult,
    promptError,
    copied,
    questionAnswers,
    isSubmittingAnswers,
    setQuestionAnswers,
    setPromptResult,
    setPromptError,
    generatePrompt,
    handleSubmitAnswers,
    handleCopyPrompt,
    handleUsePrompt,
    getCategoryLabel,
  } = usePromptOptimization({ taskId, onPromptGenerated });

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

  // Derived analysis status icon
  const getAnalysisStatus = (): 'loading' | 'success' | 'error' | 'idle' => {
    if (isAnalyzing || isGeneratingPrompt) return 'loading';
    if (analysisError || promptError) return 'error';
    if (analysisResult || promptResult) return 'success';
    return 'idle';
  };

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
    return 'idle';
  };

  const hasSubtasks = !!(subtasks && subtasks.length > 0);

  // Subtask selection helpers
  const handleSelectSubtask = useCallback((index: number) => {
    setSelectedSubtasks((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    if (!analysisResult?.suggestedSubtasks) return;
    const allIndices = analysisResult.suggestedSubtasks.map((_, i) => i);
    setSelectedSubtasks((prev) =>
      prev.length === allIndices.length ? [] : allIndices,
    );
  }, [analysisResult]);

  const handleApproveSubtasks = useCallback(async () => {
    setIsCreatingSubtasks(true);
    try {
      const result = await onApproveSubtasks(
        selectedSubtasks.length > 0 ? selectedSubtasks : undefined,
      );
      if (result) {
        setSubtaskCreationSuccess(true);
        setSelectedSubtasks([]);
        onSubtasksCreated?.();
      }
    } finally {
      setIsCreatingSubtasks(false);
    }
  }, [selectedSubtasks, onApproveSubtasks, onSubtasksCreated]);

  return (
    <div
      className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden"
      role="region"
      aria-label="AI アシスタントパネル"
    >
      <PanelHeader
        optimizedPrompt={optimizedPrompt}
        analysisResult={analysisResult}
        onOpenSettings={onOpenSettings}
      />

      <AnalysisSection
        isExpanded={expandedSection === 'analysis'}
        onToggle={() => toggleSection('analysis')}
        analysisStatusIcon={getAnalysisStatus()}
        analysisTab={analysisTab}
        onTabChange={setAnalysisTab}
        isAnalyzing={isAnalyzing}
        analysisError={analysisError}
        analysisResult={analysisResult}
        analysisApprovalId={analysisApprovalId}
        selectedSubtasks={selectedSubtasks}
        onSelectSubtask={handleSelectSubtask}
        onSelectAll={handleSelectAll}
        isCreatingSubtasks={isCreatingSubtasks}
        subtaskCreationSuccess={subtaskCreationSuccess}
        onApproveSubtasks={handleApproveSubtasks}
        onAnalyze={onAnalyze}
        isGeneratingPrompt={isGeneratingPrompt}
        promptResult={promptResult}
        promptError={promptError}
        questionAnswers={questionAnswers}
        isSubmittingAnswers={isSubmittingAnswers}
        copied={copied}
        onSetQuestionAnswer={(id, value) =>
          setQuestionAnswers((prev) => ({ ...prev, [id]: value }))
        }
        onCancelQuestions={() => {
          setPromptResult(null);
          setQuestionAnswers({});
        }}
        onSubmitAnswers={handleSubmitAnswers}
        onCopyPrompt={handleCopyPrompt}
        onUsePrompt={handleUsePrompt}
        onRegeneratePrompt={() => {
          setPromptResult(null);
          generatePrompt();
        }}
        onGeneratePrompt={() => generatePrompt()}
        onRetryPrompt={() => {
          setPromptError(null);
          generatePrompt();
        }}
        getCategoryLabel={getCategoryLabel}
      />

      {showAgentPanel && (
        <ExecutionSection
          isExpanded={expandedSection === 'execution'}
          onToggle={() => toggleSection('execution')}
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
          isGeneratingBranchName={exec.isGeneratingBranchName}
          onSetInstruction={exec.setInstruction}
          onSetBranchName={exec.setBranchName}
          onGenerateBranchName={exec.handleGenerateBranchName}
          onExecute={exec.handleExecute}
          onStop={exec.handleStopExecution}
          onReset={exec.handleReset}
          onRerun={exec.handleRerunExecution}
        />
      )}
    </div>
  );
}
