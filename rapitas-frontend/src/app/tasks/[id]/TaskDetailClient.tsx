/**
 * TaskDetailClient
 *
 * Orchestrates the task detail page: resolves the task ID, coordinates
 * all extracted hooks, and composes the page layout via TaskDetailContent.
 * Business logic lives in the hooks; rendering lives in the components.
 */

'use client';
import { useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { usePomodoro } from '@/feature/tasks/pomodoro/PomodoroProvider';
import TaskDetailSkeleton from '@/components/ui/skeleton/TaskDetailSkeleton';
import { useExecutionStateStore } from '@/stores/executionStateStore';
import { requireAuth } from '@/contexts/AuthContext';
import { useWorkflowFiles } from '@/hooks/useWorkflowFiles';
import { createLogger } from '@/lib/logger';

// Extracted hooks
import { useTaskActions } from './hooks/useTaskActions';
import { useCommentSystem } from './hooks/useCommentSystem';
import { useTaskDetailData } from './hooks/useTaskDetailData';
import { useWorkflowHandlers } from './hooks/useWorkflowHandlers';
import { useAutoExecute } from './hooks/useAutoExecute';
import { useAnalysisHandlers } from './hooks/useAnalysisHandlers';
import { useDeveloperModeEffects } from './hooks/useDeveloperModeEffects';
import { useParallelExecutionSetup } from './hooks/useParallelExecutionSetup';
import { useDeveloperModeSetup } from './hooks/useDeveloperModeSetup';

// Extracted components
import TaskDetailErrorState from './components/TaskDetailErrorState';
import TaskDetailContent from './components/TaskDetailContent';
import type { TaskDetailViewBodyProps } from './components/TaskDetailViewBody';

const logger = createLogger('TaskDetailClient');

interface TaskDetailClientProps {
  taskId?: number;
  onTaskUpdated?: () => void;
  onClose?: () => void;
}

function TaskDetailClient({
  taskId: propTaskId,
  onTaskUpdated,
}: TaskDetailClientProps) {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isPageMode = searchParams.get('showHeader') === 'true';

  // NOTE: useParams() may not work in Tauri iframes,
  // so we fall back to extracting the ID from window.location.
  const getTaskIdFromUrl = (): string | null => {
    if (typeof window === 'undefined') return null;
    const match = window.location.pathname.match(/\/tasks\/(\d+)/);
    return match ? match[1] : null;
  };

  // Priority: propTaskId > params.id > URL extraction
  const resolvedTaskId =
    propTaskId?.toString() ||
    (params?.id as string | undefined) ||
    getTaskIdFromUrl();

  logger.debug('[TaskDetailClient] resolvedTaskId:', resolvedTaskId);

  const taskId = resolvedTaskId ? parseInt(resolvedTaskId) : 0;

  // ─── Data fetching ────────────────────────────────────────────────────────
  const {
    task,
    setTask,
    loading,
    showSkeleton,
    error,
    comments,
    setComments,
    resources,
    setResources,
    globalSettings,
    showAIAssistant,
    setShowAIAssistant,
    refreshTask,
  } = useTaskDetailData({ resolvedTaskId });

  // ─── Pomodoro ────────────────────────────────────────────────────────────
  const [showPomodoroModal, setShowPomodoroModal] = useState(false);
  const { state: pomodoroState, stopTimer } = usePomodoro();
  const isThisTaskTimer = pomodoroState.taskId === task?.id;

  // ─── Developer mode ───────────────────────────────────────────────────────
  const [showDevModeConfig, setShowDevModeConfig] = useState(false);
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);
  const {
    devModeConfig,
    devModeLoading,
    isAnalyzing,
    isExecuting,
    executionStatus,
    executionResult,
    analysisResult,
    analysisApprovalId,
    analysisError,
    fetchDevModeConfig,
    enableDeveloperMode,
    updateDevModeConfig,
    analyzeTask,
    setAnalysisResult,
    executeAgent,
    resetExecutionState,
    restoreExecutionState,
    approveSubtaskCreation,
    setExecutionCancelled,
    agentConfigId,
    setAgentConfigId,
    agents,
    fetchAgents,
    approveRequest,
    rejectRequest,
    approvalLoading,
  } = useDeveloperModeSetup(taskId);

  // ─── Workflow ─────────────────────────────────────────────────────────────
  const {
    files: workflowFiles,
    workflowStatus,
    isLoading: isWorkflowLoading,
    error: workflowError,
    refetch: refetchWorkflowFiles,
  } = useWorkflowFiles(taskId || null);

  const {
    currentWorkflowStatus,
    setCurrentWorkflowStatus,
    showPlanApprovalModal,
    closePlanApprovalModal,
    handlePlanApprovalRequest,
    handleApprovalComplete,
    handleWorkflowComplete,
  } = useWorkflowHandlers({
    taskId,
    workflowStatus,
    refetchWorkflowFiles,
    restoreExecutionState,
    onTaskUpdated,
  });

  // ─── Parallel execution ───────────────────────────────────────────────────
  const {
    parallelSessionId,
    isParallelExecutionRunning,
    getSubtaskStatus,
    startSession,
    subtaskLogs,
    refreshSubtaskLogs,
  } = useParallelExecutionSetup({ taskId, taskSubtasks: task?.subtasks });

  const { isTaskExecuting } = useExecutionStateStore();
  const isTaskExecutingInStore = isTaskExecuting(taskId);

  // ─── Task actions / comment system ────────────────────────────────────────
  const [newComment, setNewComment] = useState('');
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [showCompleteOverlay, setShowCompleteOverlay] = useState(false);

  const taskActions = useTaskActions({
    task,
    resolvedTaskId,
    setTask,
    onTaskUpdated,
    isThisTaskTimer,
    pomodoroState,
    stopTimer,
    setShowPomodoroModal,
    setShowCompleteOverlay,
  });

  const commentSystem = useCommentSystem({
    resolvedTaskId,
    comments,
    setComments,
    newComment,
    setNewComment,
    setIsAddingComment,
  });

  // ─── Side effects ─────────────────────────────────────────────────────────
  useDeveloperModeEffects({
    resolvedTaskId,
    taskId,
    task,
    globalSettings,
    devModeConfig,
    devModeLoading,
    isExecuting,
    executionResult,
    isParallelExecutionRunning,
    parallelSessionId,
    isTaskExecutingInStore,
    fetchDevModeConfig,
    fetchAgents,
    enableDeveloperMode,
    setShowAIAssistant,
  });

  useAutoExecute({
    task,
    loading,
    isExecuting,
    taskId,
    searchParams,
    executeAgent,
    setShowAIAssistant,
    setTask,
  });

  // ─── Analysis handlers ────────────────────────────────────────────────────
  const {
    optimizedPrompt,
    setOptimizedPrompt,
    handleAnalyze,
    handleApproveAnalysis,
    handleRejectAnalysis,
  } = useAnalysisHandlers({
    resolvedTaskId,
    setTask,
    analyzeTask,
    setAnalysisResult,
    approveRequest,
    rejectRequest,
  });

  // ─── Render guards ────────────────────────────────────────────────────────
  if (loading || showSkeleton) {
    return <TaskDetailSkeleton />;
  }

  if (error || !task) {
    return (
      <TaskDetailErrorState
        error={error}
        onBackToHome={() => router.push('/')}
      />
    );
  }

  const showAIPanel =
    task.theme?.isDevelopment === true &&
    (showAIAssistant ||
      devModeConfig?.isEnabled === true ||
      isExecuting ||
      isParallelExecutionRunning ||
      executionResult !== null ||
      analysisResult !== null ||
      isTaskExecutingInStore);

  // ─── Render ───────────────────────────────────────────────────────────────
  const aiSectionProps = {
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
    isApproving: approvalLoading,
    optimizedPrompt,
    resources,
    agentConfigId,
    agents,
    subtaskLogs,
    onOpenSettings: () => setShowDevModeConfig(true),
    onAnalyze: handleAnalyze,
    onApprove: handleApproveAnalysis,
    onReject: handleRejectAnalysis,
    onApproveSubtasks: approveSubtaskCreation,
    onPromptGenerated: setOptimizedPrompt,
    onAgentChange: setAgentConfigId,
    onExecute: async (options?: unknown) => {
      const result = await executeAgent(options);
      return result as { sessionId?: number; message?: string } | null;
    },
    onReset: resetExecutionState,
    onRestoreExecutionState: restoreExecutionState,
    onStopExecution: setExecutionCancelled,
    onStartParallelExecution: startSession,
    getSubtaskStatus,
    onRefreshSubtaskLogs: refreshSubtaskLogs,
    setTask,
    refetchWorkflowFiles,
    onTaskUpdated,
    startSession,
  };

  const viewBodyProps: Omit<
    TaskDetailViewBodyProps,
    'task' | 'taskId' | 'resolvedTaskId' | 'taskActions'
  > = {
    resources,
    setResources,
    comments,
    newComment,
    isAddingComment,
    setNewComment,
    commentSystem,
    refreshTask,
    showAIPanel,
    aiSectionProps,
    currentWorkflowStatus,
    setCurrentWorkflowStatus,
    isWorkflowLoading,
    workflowError,
    onPlanApprovalRequest: handlePlanApprovalRequest,
    onWorkflowComplete: handleWorkflowComplete,
    onTaskUpdated,
    setTask,
    isParallelExecutionRunning,
    getSubtaskStatus,
  };

  return (
    <TaskDetailContent
      task={task}
      taskId={taskId}
      resolvedTaskId={resolvedTaskId!}
      showSkeleton={showSkeleton}
      isPageMode={isPageMode}
      isThisTaskTimer={isThisTaskTimer}
      pomodoroState={pomodoroState}
      showPomodoroModal={showPomodoroModal}
      setShowPomodoroModal={setShowPomodoroModal}
      showDevModeConfig={showDevModeConfig}
      setShowDevModeConfig={setShowDevModeConfig}
      showSaveTemplateDialog={showSaveTemplateDialog}
      setShowSaveTemplateDialog={setShowSaveTemplateDialog}
      showPlanApprovalModal={showPlanApprovalModal}
      onClosePlanApprovalModal={closePlanApprovalModal}
      devModeConfig={devModeConfig}
      updateDevModeConfig={updateDevModeConfig}
      agentConfigId={agentConfigId}
      setAgentConfigId={setAgentConfigId}
      planFile={workflowFiles?.plan || null}
      onApprovalComplete={handleApprovalComplete}
      onBack={() => router.back()}
      taskActions={taskActions}
      viewBodyProps={viewBodyProps}
    />
  );
}

// Export as auth-required component
export default requireAuth(TaskDetailClient);
