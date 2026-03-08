'use client';
import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type {
  Task,
  TimeEntry,
  Comment,
  UserSettings,
  Resource,
} from '@/types';
import {
  Save,
  Copy,
  Pencil,
  X,
  FileStack,
  Trash2,
  ArrowLeft,
} from 'lucide-react';
import { useParallelExecutionStatus } from '@/feature/tasks/hooks/useParallelExecutionStatus';
import { useSubtaskLogs } from '@/feature/tasks/hooks/useSubtaskLogs';
import {
  usePomodoro,
} from '@/feature/tasks/pomodoro/PomodoroProvider';
import { useDeveloperMode } from '@/feature/developer-mode/hooks/useDeveloperMode';
import CompactTaskDetailCard from '@/feature/tasks/components/CompactTaskDetailCard';
import { useApprovals } from '@/feature/developer-mode/hooks/useApprovals';
import { AIAccordionPanel } from '@/feature/developer-mode/components/AIAccordionPanel';
import DropdownMenu from '@/components/ui/dropdown/DropdownMenu';
import TaskDetailSkeleton from '@/components/ui/skeleton/TaskDetailSkeleton';
import { API_BASE_URL } from '@/utils/api';
import { apiFetch } from '@/lib/api-client';
import { preloadTaskDetails } from '@/lib/task-api';
import { recordTaskAccess } from '@/lib/cache-warmup';
import { useExecutionStateStore } from '@/stores/executionStateStore';
import { requireAuth } from '@/contexts/AuthContext';
import type { WorkflowStatus } from '@/types';
import { useWorkflowFiles } from '@/hooks/useWorkflowFiles';
import { createLogger } from '@/lib/logger';

// Extracted hooks and components
import { useTaskActions } from './hooks/useTaskActions';
import { useCommentSystem } from './hooks/useCommentSystem';
import TaskPomodoroButton from './components/TaskPomodoroButton';
import TaskWorkflowSection from './components/TaskWorkflowSection';
import TaskEditForm from './components/TaskEditForm';
import SubtaskSection from './components/SubtaskSection';
import TaskDetailModals from './components/TaskDetailModals';

const logger = createLogger('TaskDetailClient');
const API_BASE = API_BASE_URL;

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
  const t = useTranslations('task');
  const tc = useTranslations('common');

  // ページモード（ヘッダー表示フラグ）の確認
  const isPageMode = searchParams.get('showHeader') === 'true';

  // TauriのiframeではuseParams()が正しく動作しない場合があるため、
  // window.locationからIDを直接抽出するフォールバックを追加
  const getTaskIdFromUrl = (): string | null => {
    if (typeof window === 'undefined') return null;
    const match = window.location.pathname.match(/\/tasks\/(\d+)/);
    return match ? match[1] : null;
  };

  // propTaskIdを最優先、次にparams.id、最後にURLから直接取得
  const taskIdFromParams = params?.id as string | undefined;
  const taskIdFromUrl = getTaskIdFromUrl();
  const resolvedTaskId =
    propTaskId?.toString() || taskIdFromParams || taskIdFromUrl;

  // デバッグログ
  logger.debug('[TaskDetailClient] params:', params);
  logger.debug(
    '[TaskDetailClient] window.location:',
    typeof window !== 'undefined' ? window.location.href : 'SSR',
  );
  logger.debug('[TaskDetailClient] params.id:', params?.id);
  logger.debug('[TaskDetailClient] resolvedTaskId:', resolvedTaskId);

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skeletonStartRef = useRef<number>(Date.now());
  const taskLoadedRef = useRef(false);

  // 時間トラッキング用の状態
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);

  // コメント用の状態
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isAddingComment, setIsAddingComment] = useState(false);

  // リソース/添付ファイル用の状態
  const [resources, setResources] = useState<Resource[]>([]);

  // サブタスクアコーディオン用の状態
  const [isSubtasksExpanded, setIsSubtasksExpanded] = useState(true);

  // タスク完了オーバーレイ用の状態
  const [showCompleteOverlay, setShowCompleteOverlay] = useState(false);

  // ポモドーロモーダル用の状態
  const [showPomodoroModal, setShowPomodoroModal] = useState(false);
  const { state: pomodoroState, stopTimer } = usePomodoro();

  const isThisTaskTimer = pomodoroState.taskId === task?.id;

  // 開発者モード用の状態
  const [showDevModeConfig, setShowDevModeConfig] = useState(false);
  const taskId = resolvedTaskId ? parseInt(resolvedTaskId) : 0;
  const {
    config: devModeConfig,
    isLoading: devModeLoading,
    isAnalyzing,
    isExecuting,
    executionStatus,
    executionResult,
    analysisResult,
    analysisApprovalId,
    analysisError,
    fetchConfig: fetchDevModeConfig,
    enableDeveloperMode,
    updateConfig: updateDevModeConfig,
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
  } = useDeveloperMode(taskId);

  const {
    approve: approveRequest,
    reject: rejectRequest,
    isLoading: approvalLoading,
  } = useApprovals();
  const [pendingApprovalId, setPendingApprovalId] = useState<number | null>(
    null,
  );

  // ワークフロー関連の状態
  const [showPlanApprovalModal, setShowPlanApprovalModal] = useState(false);
  const [currentWorkflowStatus, setCurrentWorkflowStatus] =
    useState<WorkflowStatus | null>(null);

  const {
    files: workflowFiles,
    workflowStatus,
    isLoading: isWorkflowLoading,
    error: workflowError,
    refetch: refetchWorkflowFiles,
    hasAnyFile: hasAnyWorkflowFile,
  } = useWorkflowFiles(taskId || null);

  // --- Extracted hooks ---

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

  // ワークフローステータスの同期
  useEffect(() => {
    if (workflowStatus && workflowStatus !== currentWorkflowStatus) {
      setCurrentWorkflowStatus(workflowStatus);
    }
  }, [workflowStatus]);

  const handlePlanApprovalRequest = () => {
    setShowPlanApprovalModal(true);
  };

  const handleApprovalComplete = (approved: boolean, newStatus?: string) => {
    if (approved && newStatus) {
      setCurrentWorkflowStatus(newStatus as WorkflowStatus);
      if (onTaskUpdated) onTaskUpdated();

      // 承認後にバックエンドがエージェントを起動するまで待機し、実行状態を復元する
      let attempts = 0;
      const maxAttempts = 10;

      const tryRestoreExecution = async () => {
        attempts++;
        try {
          const result = await restoreExecutionState();
          if (result && result.status === 'running') {
            logger.debug('[TaskDetailClient] Execution state restored after approval');
            return;
          }

          if (attempts < maxAttempts) {
            setTimeout(tryRestoreExecution, 2000);
          }
        } catch (err) {
          logger.warn('[TaskDetailClient] Failed to restore execution state:', err);
          if (attempts < maxAttempts) {
            setTimeout(tryRestoreExecution, 2000);
          }
        }
      };

      setTimeout(tryRestoreExecution, 1000);
    }
    refetchWorkflowFiles();
    setShowPlanApprovalModal(false);
  };

  const handleWorkflowComplete = async () => {
    if (!taskId) return;
    try {
      const response = await fetch(
        `${API_BASE}/workflow/tasks/${taskId}/status`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        },
      );
      const data = await response.json();
      if (data.success) {
        setCurrentWorkflowStatus('completed');
        refetchWorkflowFiles();
        if (onTaskUpdated) onTaskUpdated();
      }
    } catch (err) {
      logger.error('Error completing workflow:', err);
    }
  };

  // グローバル設定の状態
  const [globalSettings, setGlobalSettings] = useState<UserSettings | null>(
    null,
  );

  // AIアシスタントパネルの表示状態（グローバル設定から初期化）
  const [showAIAssistant, setShowAIAssistant] = useState(false);

  // テンプレート保存モーダル用の状態
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);

  // 最適化されたプロンプト用の状態
  const [optimizedPrompt, setOptimizedPrompt] = useState<string | null>(null);

  // 並列実行ステータス管理
  const {
    sessionId: parallelSessionId,
    sessionState: parallelSessionState,
    isRunning: isParallelExecutionRunning,
    getSubtaskStatus,
    startSession,
  } = useParallelExecutionStatus({
    taskId,
    enableSSE: true,
  });

  // グローバル実行状態から現在のタスクの実行状態を確認
  const { isTaskExecuting } = useExecutionStateStore();
  const isTaskExecutingInStore = isTaskExecuting(taskId);

  // サブタスクごとの実行ログ管理
  const subtasksForLogs = useMemo(() => {
    return (task?.subtasks || []).map((s) => ({ id: s.id, title: s.title }));
  }, [task?.subtasks]);

  const { subtaskLogs, refreshLogs: refreshSubtaskLogs } = useSubtaskLogs({
    sessionId: parallelSessionId,
    subtasks: subtasksForLogs,
    autoRefresh: true,
    pollingInterval: 2000,
    sessionStatus: parallelSessionState?.status,
  });

  useEffect(() => {
    const SKELETON_MIN_DURATION = 400;

    const isInitialLoad = !taskLoadedRef.current;
    const fetchTask = async () => {
      try {
        if (isInitialLoad) {
          setLoading(true);
          setShowSkeleton(true);
          skeletonStartRef.current = Date.now();
        }
        const data = await apiFetch<Task>(`/tasks/${resolvedTaskId}`, {
          cacheTime: 24 * 60 * 60 * 1000,
        });
        setTask(data);
        taskLoadedRef.current = true;

        if (resolvedTaskId) {
          const numericTaskId = parseInt(resolvedTaskId, 10);
          if (!isNaN(numericTaskId)) {
            recordTaskAccess(numericTaskId);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('fetchFailed'));
      } finally {
        if (isInitialLoad) {
          setLoading(false);
          const elapsed = Date.now() - skeletonStartRef.current;
          const remaining = SKELETON_MIN_DURATION - elapsed;
          if (remaining > 0) {
            skeletonTimerRef.current = setTimeout(() => {
              setShowSkeleton(false);
            }, remaining);
          } else {
            setShowSkeleton(false);
          }
        }
      }
    };

    const fetchTimeEntries = async () => {
      try {
        const data = await apiFetch<TimeEntry[]>(
          `/tasks/${resolvedTaskId}/time-entries`,
          { cacheTime: 60 * 60 * 1000 }
        );
        setTimeEntries(data);
      } catch (err) {
        logger.error('Failed to fetch time entries:', err);
      }
    };

    const fetchComments = async () => {
      try {
        const data = await apiFetch<Comment[]>(
          `/tasks/${resolvedTaskId}/comments`,
          { cacheTime: 60 * 60 * 1000 }
        );
        setComments(data);
      } catch (err) {
        logger.error('Failed to fetch comments:', err);
      }
    };

    const fetchResources = async () => {
      try {
        const data = await apiFetch<Resource[]>(
          `/tasks/${resolvedTaskId}/resources`,
          { cacheTime: 60 * 60 * 1000 }
        );
        setResources(data);
      } catch (err) {
        logger.error('Failed to fetch resources:', err);
      }
    };

    const fetchGlobalSettings = async () => {
      try {
        const data = await apiFetch<UserSettings>('/settings', {
          cacheTime: 6 * 60 * 60 * 1000,
        });
        setGlobalSettings(data);
        if (data.aiTaskAnalysisDefault) {
          setShowAIAssistant(true);
        }
      } catch (err) {
        logger.error('Failed to fetch global settings:', err);
      }
    };

    if (resolvedTaskId) {
      Promise.all([
        fetchTask(),
        fetchTimeEntries(),
        fetchComments(),
        fetchResources(),
        fetchDevModeConfig(),
        fetchAgents(),
        fetchGlobalSettings(),
      ]);

      if (task?.subtasks && task.subtasks.length > 0) {
        const subtaskIds = task.subtasks.map(s => s.id);
        preloadTaskDetails(subtaskIds);
      }
    }

    return () => {
      if (skeletonTimerRef.current) {
        clearTimeout(skeletonTimerRef.current);
        skeletonTimerRef.current = null;
      }
    };
  }, [resolvedTaskId, fetchDevModeConfig, fetchAgents]);

  // コンテンツ表示準備完了フラグ
  const [contentReady, setContentReady] = useState(false);

  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (!showSkeleton && containerRef.current && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      containerRef.current.scrollTop = 0;
      setContentReady(false);
      requestAnimationFrame(() => {
        setContentReady(true);
      });
    }
  }, [showSkeleton]);

  // グローバル設定に基づいて開発者モードを自動有効化
  useEffect(() => {
    const autoEnableDeveloperMode = async () => {
      if (
        globalSettings?.aiTaskAnalysisDefault &&
        task?.theme?.isDevelopment === true &&
        devModeConfig === null &&
        !devModeLoading &&
        taskId
      ) {
        await enableDeveloperMode();
      }
    };
    autoEnableDeveloperMode();
  }, [
    globalSettings,
    task?.theme?.isDevelopment,
    devModeConfig,
    devModeLoading,
    taskId,
    enableDeveloperMode,
  ]);

  // 開発者モードが有効な場合、AIアシスタントパネルを表示
  useEffect(() => {
    if (
      devModeConfig?.isEnabled === true ||
      isExecuting ||
      executionResult !== null ||
      isParallelExecutionRunning ||
      parallelSessionId !== null ||
      isTaskExecutingInStore
    ) {
      setShowAIAssistant(true);
    }
  }, [
    devModeConfig?.isEnabled,
    isExecuting,
    executionResult,
    isParallelExecutionRunning,
    parallelSessionId,
    isTaskExecutingInStore,
  ]);

  // autoExecute=true パラメータによる自動実行
  const autoExecuteTriggered = useRef(false);
  useEffect(() => {
    const shouldAutoExecute = searchParams.get('autoExecute') === 'true';
    if (
      shouldAutoExecute &&
      !autoExecuteTriggered.current &&
      task &&
      !loading &&
      !isExecuting &&
      taskId
    ) {
      autoExecuteTriggered.current = true;

      if (!task.theme?.isDevelopment) {
        logger.warn(
          `[TaskDetail] Skipping auto-execute for task ${taskId}: theme is not a development project`,
        );
      } else if (!isExecuting) {
        setShowAIAssistant(true);
        if (task && task.status !== 'in-progress') {
          setTask((prev) => {
            if (!prev) return prev;
            return { ...prev, status: 'in-progress' };
          });
        }
        executeAgent();
      } else {
        logger.warn(
          `[TaskDetail] Skipping auto-execute for task ${taskId}: already executing`,
        );
      }
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete('autoExecute');
      const newQuery = newParams.toString();
      const basePath = window.location.pathname;
      router.replace(newQuery ? `${basePath}?${newQuery}` : basePath);
    }
  }, [task, loading, isExecuting, taskId, searchParams, executeAgent, router]);

  // AI分析の実行
  const handleAnalyze = async () => {
    const result = await analyzeTask();
    if (result?.approvalRequestId) {
      setPendingApprovalId(result.approvalRequestId);
    }
    if (result?.autoApproved) {
      const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
      if (res.ok) {
        setTask(await res.json());
      }
    }
  };

  // 承認
  const handleApproveAnalysis = async (arg?: number | number[]) => {
    const approvalId = typeof arg === 'number' ? arg : pendingApprovalId;
    const selectedSubtasks = Array.isArray(arg) ? arg : undefined;
    if (!approvalId) return;
    const result = await approveRequest(approvalId, selectedSubtasks);
    if (result?.success) {
      setAnalysisResult(null);
      setPendingApprovalId(null);
      const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
      if (res.ok) {
        setTask(await res.json());
      }
    }
  };

  // 却下
  const handleRejectAnalysis = async () => {
    if (!pendingApprovalId) return;
    await rejectRequest(pendingApprovalId);
    setAnalysisResult(null);
    setPendingApprovalId(null);
  };

  // Loading state
  if (loading || showSkeleton) {
    return <TaskDetailSkeleton />;
  }

  // Error state
  if (error || !task) {
    return (
      <div className="h-[calc(100vh-5rem)] overflow-auto bg-background flex items-center justify-center scrollbar-thin">
        <div className="text-center bg-white dark:bg-indigo-dark-900 rounded-2xl p-8 shadow-xl border border-zinc-200 dark:border-zinc-800">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <span className="text-3xl">!</span>
          </div>
          <p className="text-red-600 dark:text-red-400 mb-4 font-medium">
            {error || t('notFound')}
          </p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium"
          >
            {t('backToHome')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`h-[calc(100vh-5rem)] bg-background scrollbar-thin transition-opacity duration-200 ${
        contentReady ? 'overflow-auto opacity-100' : 'overflow-hidden opacity-0'
      }`}
    >
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header Actions */}
        <div className="mb-6 flex items-center justify-between gap-2">
          {/* 戻るボタン（ページモード時のみ表示） */}
          <div>
            {isPageMode && (
              <button
                onClick={() => router.back()}
                className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="text-sm font-medium">{tc('back')}</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!taskActions.isEditing && (
              <TaskPomodoroButton
                taskTitle={task.title}
                isThisTaskTimer={isThisTaskTimer}
                pomodoroState={pomodoroState}
                onClick={() => setShowPomodoroModal(true)}
              />
            )}

            {!taskActions.isEditing ? (
              <>
                <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-blue-500 dark:hover:border-blue-400">
                  <button
                    onClick={taskActions.startEditing}
                    className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-all cursor-pointer"
                  >
                    <Pencil className="w-4 h-4" />
                    <span className="font-mono text-xs font-black tracking-tight">
                      {tc('edit')}
                    </span>
                  </button>
                </div>
                <DropdownMenu
                  items={[
                    {
                      label: t('duplicateTask'),
                      icon: <Copy className="w-4 h-4" />,
                      onClick: taskActions.duplicateTask,
                    },
                    {
                      label: t('saveAsTemplate'),
                      icon: <FileStack className="w-4 h-4" />,
                      onClick: () => setShowSaveTemplateDialog(true),
                    },
                    {
                      label: tc('delete'),
                      icon: <Trash2 className="w-4 h-4" />,
                      onClick: taskActions.deleteTask,
                      variant: 'danger',
                    },
                  ]}
                />
              </>
            ) : (
              <>
                <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-green-500 dark:hover:border-green-400">
                  <button
                    onClick={taskActions.saveTask}
                    className="flex items-center gap-2 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 transition-all cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span className="font-mono text-xs font-black tracking-tight">
                      {tc('save')}
                    </span>
                  </button>
                </div>
                <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-gray-500 dark:hover:border-gray-400">
                  <button
                    onClick={taskActions.cancelEditing}
                    className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                    <span className="font-mono text-xs font-black tracking-tight">
                      {tc('cancel')}
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {taskActions.isEditing ? (
          <TaskEditForm
            editTitle={taskActions.editTitle}
            setEditTitle={taskActions.setEditTitle}
            editStatus={taskActions.editStatus}
            setEditStatus={taskActions.setEditStatus}
            editDescription={taskActions.editDescription}
            setEditDescription={taskActions.setEditDescription}
            editLabelIds={taskActions.editLabelIds}
            setEditLabelIds={taskActions.setEditLabelIds}
            editPriority={taskActions.editPriority}
            setEditPriority={taskActions.setEditPriority}
            editEstimatedHours={taskActions.editEstimatedHours}
            setEditEstimatedHours={taskActions.setEditEstimatedHours}
          />
        ) : (
          /* View Mode */
          <>
            {/* Compact Main Card with Accordion - All-in-one */}
            <div className="mb-6">
              <CompactTaskDetailCard
                task={task}
                onStatusUpdate={taskActions.updateStatus}
                resources={resources}
                onResourcesChange={async () => {
                  const res = await fetch(
                    `${API_BASE}/tasks/${resolvedTaskId}/resources`,
                  );
                  if (res.ok) setResources(await res.json());
                }}
                comments={comments}
                newComment={newComment}
                isAddingComment={isAddingComment}
                onNewCommentChange={setNewComment}
                onAddComment={commentSystem.handleAddComment}
                onUpdateComment={commentSystem.handleUpdateComment}
                onDeleteComment={commentSystem.handleDeleteComment}
                onCreateLink={commentSystem.handleCreateCommentLink}
                onDeleteLink={commentSystem.handleDeleteCommentLink}
              />
            </div>

            {/* AI アシスタント統合パネル */}
            {task.theme?.isDevelopment === true &&
             (showAIAssistant ||
              devModeConfig?.isEnabled === true ||
              isExecuting ||
              isParallelExecutionRunning ||
              executionResult !== null ||
              analysisResult !== null ||
              isTaskExecutingInStore) && (
              <div className="mb-6">
                <AIAccordionPanel
                  taskId={taskId}
                  taskTitle={task.title}
                  taskDescription={task.description}
                  config={devModeConfig}
                  onOpenSettings={() => setShowDevModeConfig(true)}
                  isAnalyzing={isAnalyzing}
                  analysisResult={analysisResult}
                  analysisError={analysisError}
                  analysisApprovalId={analysisApprovalId}
                  onAnalyze={handleAnalyze}
                  onApprove={handleApproveAnalysis}
                  onReject={handleRejectAnalysis}
                  onApproveSubtasks={approveSubtaskCreation}
                  isApproving={approvalLoading}
                  onPromptGenerated={(prompt) => setOptimizedPrompt(prompt)}
                  onSubtasksCreated={async () => {
                    try {
                      const res = await fetch(
                        `${API_BASE}/tasks/${resolvedTaskId}`,
                      );
                      if (!res.ok) {
                        logger.error('[TaskDetail] Failed to fetch task after subtask creation');
                        return;
                      }

                      const data = await res.json();
                      setTask(data);

                      await new Promise(resolve => setTimeout(resolve, 500));

                      try {
                        const configRes = await fetch(
                          `${API_BASE}/agent-execution-config/${resolvedTaskId}`,
                        );
                        if (!configRes.ok) {
                          logger.warn('[TaskDetail] Auto-execute config not found');
                          return;
                        }

                        const configData = await configRes.json();
                        if (configData.autoExecuteOnAnalysis) {
                          if (data.subtasks && data.subtasks.length > 0) {
                            logger.debug(
                              '[TaskDetail] Auto-executing parallel tasks after analysis',
                            );
                            startSession();
                          } else {
                            if (isExecuting) {
                              logger.warn('[TaskDetail] Skipping auto-execute: already executing');
                            } else {
                              logger.debug(
                                '[TaskDetail] Auto-executing agent after analysis',
                              );
                              if (task && task.status !== 'in-progress') {
                                setTask((prev) => {
                                  if (!prev) return prev;
                                  return { ...prev, status: 'in-progress' };
                                });
                              }
                              await executeAgent({
                                useTaskAnalysis: true,
                                optimizedPrompt: optimizedPrompt || undefined,
                                agentConfigId: agentConfigId ?? undefined,
                              });
                            }
                          }
                        }
                      } catch (err) {
                        logger.error(
                          '[TaskDetail] Failed to check auto-execute config:',
                          err,
                        );
                      }
                    } catch (err) {
                      logger.error(
                        '[TaskDetail] Error in onSubtasksCreated:',
                        err,
                      );
                    }
                  }}
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
                  onAgentChange={setAgentConfigId}
                  onExecute={async (options?) => {
                    if (isExecuting) {
                      logger.warn('[TaskDetail] Skipping execute: already executing');
                      return null;
                    }
                    if (task && task.status !== 'in-progress') {
                      setTask((prev) => {
                        if (!prev) return prev;
                        return { ...prev, status: 'in-progress' };
                      });
                    }

                    const result = await executeAgent(options);
                    return result as { sessionId?: number; message?: string } | null;
                  }}
                  onReset={resetExecutionState}
                  onRestoreExecutionState={restoreExecutionState}
                  onStopExecution={setExecutionCancelled}
                  onExecutionComplete={async () => {
                    for (let attempt = 0; attempt < 6; attempt++) {
                      await new Promise(r => setTimeout(r, attempt === 0 ? 1000 : 2000));
                      try {
                        const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
                        if (res.ok) {
                          const data = await res.json();
                          setTask(data);
                          if (data.status === 'done') break;
                        }
                      } catch { /* retry */ }
                    }
                    refetchWorkflowFiles();
                    onTaskUpdated?.();
                  }}
                  subtasks={task.subtasks}
                  onStartParallelExecution={startSession}
                  isParallelExecutionRunning={isParallelExecutionRunning}
                  getSubtaskStatus={getSubtaskStatus}
                  parallelSessionId={parallelSessionId}
                  subtaskLogs={subtaskLogs}
                  onRefreshSubtaskLogs={refreshSubtaskLogs}
                />
              </div>
            )}

            {/* Workflow Section - 開発テーマのみ表示 */}
            {task.theme?.isDevelopment === true && (
              <TaskWorkflowSection
                task={task}
                taskId={taskId}
                currentWorkflowStatus={currentWorkflowStatus}
                setCurrentWorkflowStatus={setCurrentWorkflowStatus}
                isWorkflowLoading={isWorkflowLoading}
                workflowError={workflowError}
                onPlanApprovalRequest={handlePlanApprovalRequest}
                onWorkflowComplete={handleWorkflowComplete}
                onTaskUpdated={onTaskUpdated}
                setTask={setTask}
              />
            )}

            {/* Subtasks Section */}
            {task.subtasks && task.subtasks.length > 0 && (
              <SubtaskSection
                subtasks={task.subtasks}
                isExpanded={isSubtasksExpanded}
                onToggleExpand={() => setIsSubtasksExpanded(!isSubtasksExpanded)}
                isSubtaskSelectionMode={taskActions.isSubtaskSelectionMode}
                selectedSubtaskIds={taskActions.selectedSubtaskIds}
                showSubtaskDeleteConfirm={taskActions.showSubtaskDeleteConfirm}
                editingSubtaskId={taskActions.editingSubtaskId}
                editingSubtaskTitle={taskActions.editingSubtaskTitle}
                editingSubtaskDescription={taskActions.editingSubtaskDescription}
                isParallelExecutionRunning={isParallelExecutionRunning}
                getSubtaskStatus={getSubtaskStatus}
                onToggleSelectionMode={taskActions.toggleSubtaskSelectionMode}
                onSelectAll={taskActions.selectAllSubtasks}
                onDeselectAll={taskActions.deselectAllSubtasks}
                onToggleSubtaskSelection={taskActions.toggleSubtaskSelection}
                onSetDeleteConfirm={taskActions.setShowSubtaskDeleteConfirm}
                onDeleteAll={taskActions.handleDeleteAllSubtasks}
                onDeleteSelected={taskActions.handleDeleteSelectedSubtasks}
                onStartEditingSubtask={taskActions.startEditingSubtask}
                onSetEditingSubtaskTitle={taskActions.setEditingSubtaskTitle}
                onSetEditingSubtaskDescription={taskActions.setEditingSubtaskDescription}
                onSaveSubtaskEdit={taskActions.saveSubtaskEdit}
                onCancelEditingSubtask={taskActions.cancelEditingSubtask}
                onUpdateStatus={taskActions.updateStatus}
              />
            )}
          </>
        )}
      </div>

      <TaskDetailModals
        task={task}
        taskId={taskId}
        showPomodoroModal={showPomodoroModal}
        onClosePomodoroModal={() => setShowPomodoroModal(false)}
        showDevModeConfig={showDevModeConfig}
        onCloseDevModeConfig={() => setShowDevModeConfig(false)}
        devModeConfig={devModeConfig}
        updateDevModeConfig={updateDevModeConfig}
        selectedAgentConfigId={agentConfigId}
        onAgentConfigChange={setAgentConfigId}
        showSaveTemplateDialog={showSaveTemplateDialog}
        onCloseSaveTemplateDialog={() => setShowSaveTemplateDialog(false)}
        showPlanApprovalModal={showPlanApprovalModal}
        onClosePlanApprovalModal={() => setShowPlanApprovalModal(false)}
        planFile={workflowFiles?.plan || null}
        onApprovalComplete={handleApprovalComplete}
      />
    </div>
  );
}

// 認証が必要なコンポーネントとしてエクスポート
export default requireAuth(TaskDetailClient);
