'use client';
import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type {
  Task,
  TimeEntry,
  Comment,
  UserSettings,
  Resource,
  Priority,
} from '@/types';
import LabelSelector from '@/feature/tasks/components/LabelSelector';
import TaskStatusChange from '@/feature/tasks/components/TaskStatusChange';
import {
  statusConfig as sharedStatusConfig,
  renderStatusIcon,
} from '@/feature/tasks/config/StatusConfig';
import {
  Clock,
  CheckCircle2,
  Circle,
  Trash2,
  FileText,
  Tag,
  Save,
  Copy,
  ChevronDown,
  ChevronUp,
  ChevronsUp,
  ChevronsUpDown,
  Pencil,
  Check,
  X,
  FileStack,
  Bot,
  ArrowLeft,
  CheckSquare,
  Square,
  Flag,
} from 'lucide-react';
import { SubtaskTitleIndicator } from '@/feature/tasks/components/SubtaskExecutionStatus';
import { useParallelExecutionStatus } from '@/feature/tasks/hooks/useParallelExecutionStatus';
import { useSubtaskLogs } from '@/feature/tasks/hooks/useSubtaskLogs';
import GlobalPomodoroModal from '@/feature/tasks/pomodoro/GlobalPomodoroModal';
import {
  usePomodoro,
} from '@/feature/tasks/pomodoro/PomodoroProvider';
import { useDeveloperMode } from '@/feature/developer-mode/hooks/useDeveloperMode';
import CompactTaskDetailCard from '@/feature/tasks/components/CompactTaskDetailCard';
import { useApprovals } from '@/feature/developer-mode/hooks/useApprovals';
import { DeveloperModeConfigModal } from '@/feature/developer-mode/components/DeveloperModeConfig';
import { AIAccordionPanel } from '@/feature/developer-mode/components/AIAccordionPanel';
import SaveAsTemplateDialog from '@/feature/tasks/components/dialog/SaveAsTemplateDialog';
import DropdownMenu from '@/components/ui/dropdown/DropdownMenu';
import PriorityIcon from '@/feature/tasks/components/PriorityIcon';
import TaskDetailSkeleton from '@/components/ui/skeleton/TaskDetailSkeleton';
import { API_BASE_URL } from '@/utils/api';
import { apiFetch } from '@/lib/api-client';
import { preloadTaskDetails } from '@/lib/task-api';
import { recordTaskAccess } from '@/lib/cache-warmup';
import { useExecutionStateStore } from '@/stores/executionStateStore';
import { requireAuth } from '@/contexts/AuthContext';
import type { WorkflowStatus } from '@/types';
import PlanApprovalModal from '@/components/workflow/PlanApprovalModal';
import { useWorkflowFiles } from '@/hooks/useWorkflowFiles';
import { createLogger } from '@/lib/logger';

// Extracted hooks and components
import { useTaskActions } from './hooks/useTaskActions';
import { useCommentSystem } from './hooks/useCommentSystem';
import TaskPomodoroButton from './components/TaskPomodoroButton';
import TaskWorkflowSection from './components/TaskWorkflowSection';

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
        setError(err instanceof Error ? err.message : 'タスクの取得に失敗しました');
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
            {error || 'タスクが見つかりません'}
          </p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium"
          >
            ホームに戻る
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
                <span className="text-sm font-medium">戻る</span>
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
                      編集
                    </span>
                  </button>
                </div>
                <DropdownMenu
                  items={[
                    {
                      label: '複製',
                      icon: <Copy className="w-4 h-4" />,
                      onClick: taskActions.duplicateTask,
                    },
                    {
                      label: 'テンプレート保存',
                      icon: <FileStack className="w-4 h-4" />,
                      onClick: () => setShowSaveTemplateDialog(true),
                    },
                    {
                      label: '削除',
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
                      保存
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
                      キャンセル
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {taskActions.isEditing ? (
          /* Edit Mode */
          <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
            {/* Title Input with Status */}
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <input
                  type="text"
                  className="flex-1 min-w-0 text-2xl font-bold bg-transparent border-none outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
                  value={taskActions.editTitle}
                  onChange={(e) => taskActions.setEditTitle(e.target.value)}
                  placeholder="タスクのタイトル"
                />
                <div className="flex items-center gap-1 shrink-0">
                  {(['todo', 'in-progress', 'done'] as const).map((status) => {
                    const config = sharedStatusConfig[status];
                    return (
                      <TaskStatusChange
                        key={status}
                        status={status}
                        currentStatus={taskActions.editStatus}
                        config={config}
                        renderIcon={renderStatusIcon}
                        onClick={(newStatus: string) =>
                          taskActions.setEditStatus(newStatus)
                        }
                        size="md"
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-3">
                <FileText className="w-4 h-4" />
                <span className="text-sm font-medium">説明</span>
              </div>
              <textarea
                className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-3 text-sm border-none outline-none resize-none focus:ring-2 focus:ring-violet-500/20 transition-all font-mono min-h-[200px]"
                value={taskActions.editDescription}
                onChange={(e) => taskActions.setEditDescription(e.target.value)}
                placeholder="マークダウン形式で記述..."
              />
            </div>

            {/* Labels */}
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-3">
                <Tag className="w-4 h-4" />
                <span className="text-sm font-medium">ラベル</span>
              </div>
              <LabelSelector
                selectedLabelIds={taskActions.editLabelIds}
                onChange={taskActions.setEditLabelIds}
              />
            </div>

            {/* Priority */}
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-3">
                <Flag className="w-4 h-4" />
                <span className="text-sm font-medium">優先度</span>
              </div>
              <div className="flex items-center gap-1">
                {[
                  {
                    value: 'urgent' as Priority,
                    label: '緊急',
                    icon: <ChevronsUp className="w-3.5 h-3.5" />,
                    iconColor: 'text-red-500',
                    bgColor: 'bg-red-500',
                  },
                  {
                    value: 'high' as Priority,
                    label: '高',
                    icon: <ChevronUp className="w-3.5 h-3.5" />,
                    iconColor: 'text-orange-500',
                    bgColor: 'bg-orange-500',
                  },
                  {
                    value: 'medium' as Priority,
                    label: '中',
                    icon: <ChevronsUpDown className="w-3.5 h-3.5" />,
                    iconColor: 'text-blue-500',
                    bgColor: 'bg-blue-500',
                  },
                  {
                    value: 'low' as Priority,
                    label: '低',
                    icon: <ChevronDown className="w-3.5 h-3.5" />,
                    iconColor: 'text-zinc-400',
                    bgColor: 'bg-zinc-500',
                  },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => taskActions.setEditPriority(opt.value)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      taskActions.editPriority === opt.value
                        ? `${opt.bgColor} text-white shadow-md`
                        : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700'
                    }`}
                  >
                    <span
                      className={
                        taskActions.editPriority === opt.value
                          ? 'text-white'
                          : opt.iconColor
                      }
                    >
                      {opt.icon}
                    </span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Estimated Hours */}
            <div className="p-6">
              <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-3">
                <Clock className="w-4 h-4" />
                <span className="text-sm font-medium">見積もり時間</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className="w-32 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-2.5 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                  placeholder="0"
                  value={taskActions.editEstimatedHours}
                  onChange={(e) => taskActions.setEditEstimatedHours(e.target.value)}
                />
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  時間
                </span>
              </div>
            </div>
          </div>
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

            {/* Subtasks Section (AI生成含む) - アコーディオン表示 */}
            {task.subtasks && task.subtasks.length > 0 && (
              <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden mb-6">
                <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center justify-between">
                    <div
                      className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50 cursor-pointer flex-1"
                      onClick={() => setIsSubtasksExpanded(!isSubtasksExpanded)}
                    >
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      <h2 className="text-lg font-bold">サブタスク</h2>
                      <span className="ml-1 px-2 py-0.5 text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-full">
                        {
                          task.subtasks.filter((s) => s.status === 'done')
                            .length
                        }
                        /{task.subtasks.length}
                      </span>
                      {/* 進捗バー（コンパクト） */}
                      <div className="hidden sm:flex items-center gap-2 ml-2">
                        <div className="w-24 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 transition-all duration-300"
                            style={{
                              width: `${Math.round((task.subtasks.filter((s) => s.status === 'done').length / task.subtasks.length) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-zinc-500">
                          {Math.round(
                            (task.subtasks.filter((s) => s.status === 'done')
                              .length /
                              task.subtasks.length) *
                              100,
                          )}
                          %
                        </span>
                      </div>
                    </div>
                    {/* 削除操作ボタン */}
                    <div className="flex items-center gap-2">
                      {/* 選択モード切り替え */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          taskActions.toggleSubtaskSelectionMode();
                        }}
                        className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg transition-colors ${
                          taskActions.isSubtaskSelectionMode
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {taskActions.isSubtaskSelectionMode ? (
                          <>
                            <X className="w-3.5 h-3.5" />
                            解除
                          </>
                        ) : (
                          <>
                            <CheckSquare className="w-3.5 h-3.5" />
                            選択
                          </>
                        )}
                      </button>
                      {/* 選択モード時の操作 */}
                      {taskActions.isSubtaskSelectionMode && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              taskActions.selectedSubtaskIds.size === task.subtasks!.length
                                ? taskActions.deselectAllSubtasks()
                                : taskActions.selectAllSubtasks();
                            }}
                            className="px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                          >
                            {taskActions.selectedSubtaskIds.size === task.subtasks!.length
                              ? '全解除'
                              : '全選択'}
                          </button>
                          {taskActions.selectedSubtaskIds.size > 0 && (
                            <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-red-500 dark:hover:border-red-400">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  taskActions.setShowSubtaskDeleteConfirm('selected');
                                }}
                                className="flex items-center gap-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-all cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                                <span className="font-mono text-xs font-black tracking-tight">
                                  {taskActions.selectedSubtaskIds.size}件削除
                                </span>
                              </button>
                            </div>
                          )}
                        </>
                      )}
                      {/* 一括削除ボタン */}
                      {!taskActions.isSubtaskSelectionMode && (
                        <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-red-500 dark:hover:border-red-400">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              taskActions.setShowSubtaskDeleteConfirm('all');
                            }}
                            className="flex items-center gap-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-all cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span className="font-mono text-xs font-black tracking-tight">
                              全削除
                            </span>
                          </button>
                        </div>
                      )}
                      {/* アコーディオントグル */}
                      <button
                        onClick={() =>
                          setIsSubtasksExpanded(!isSubtasksExpanded)
                        }
                        className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
                      >
                        {isSubtasksExpanded ? (
                          <ChevronUp className="w-5 h-5 text-zinc-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-zinc-400" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
                {/* 削除確認ダイアログ */}
                {taskActions.showSubtaskDeleteConfirm && (
                  <div className="p-4 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800">
                    <p className="text-sm text-red-700 dark:text-red-300 mb-3">
                      {taskActions.showSubtaskDeleteConfirm === 'all'
                        ? `すべてのサブタスク（${task.subtasks.length}件）を削除しますか？この操作は取り消せません。`
                        : `選択した${taskActions.selectedSubtaskIds.size}件のサブタスクを削除しますか？この操作は取り消せません。`}
                    </p>
                    <div className="flex gap-2">
                      <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-red-500 dark:hover:border-red-400">
                        <button
                          onClick={
                            taskActions.showSubtaskDeleteConfirm === 'all'
                              ? taskActions.handleDeleteAllSubtasks
                              : taskActions.handleDeleteSelectedSubtasks
                          }
                          className="flex items-center gap-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-all cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span className="font-mono text-xs font-black tracking-tight">
                            削除する
                          </span>
                        </button>
                      </div>
                      <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-gray-500 dark:hover:border-gray-400">
                        <button
                          onClick={() => taskActions.setShowSubtaskDeleteConfirm(null)}
                          className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                          <span className="font-mono text-xs font-black tracking-tight">
                            キャンセル
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {isSubtasksExpanded && (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {task.subtasks.map((subtask) => (
                      <div
                        key={subtask.id}
                        className={`p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors ${
                          taskActions.isSubtaskSelectionMode &&
                          taskActions.selectedSubtaskIds.has(subtask.id)
                            ? 'bg-blue-50 dark:bg-blue-950/20 ring-1 ring-blue-500 dark:ring-blue-400'
                            : ''
                        }`}
                      >
                        {taskActions.editingSubtaskId === subtask.id ? (
                          /* サブタスク編集モード */
                          <div className="space-y-3">
                            <input
                              type="text"
                              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={taskActions.editingSubtaskTitle}
                              onChange={(e) =>
                                taskActions.setEditingSubtaskTitle(e.target.value)
                              }
                              placeholder="サブタスクタイトル"
                              autoFocus
                            />
                            <textarea
                              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={taskActions.editingSubtaskDescription}
                              onChange={(e) =>
                                taskActions.setEditingSubtaskDescription(e.target.value)
                              }
                              placeholder="説明（マークダウン対応）"
                              rows={3}
                            />
                            <div className="flex items-center gap-2">
                              <div className={`relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 ${!taskActions.editingSubtaskTitle.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:border-green-500 dark:hover:border-green-400'}`}>
                                <button
                                  onClick={taskActions.saveSubtaskEdit}
                                  disabled={!taskActions.editingSubtaskTitle.trim()}
                                  className={`flex items-center gap-2 transition-all ${!taskActions.editingSubtaskTitle.trim() ? 'cursor-not-allowed text-gray-400 dark:text-gray-600' : 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 cursor-pointer'}`}
                                >
                                  <Check className="w-4 h-4" />
                                  <span className="font-mono text-xs font-black tracking-tight">
                                    保存
                                  </span>
                                </button>
                              </div>
                              <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-gray-500 dark:hover:border-gray-400">
                                <button
                                  onClick={taskActions.cancelEditingSubtask}
                                  className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all cursor-pointer"
                                >
                                  <X className="w-4 h-4" />
                                  <span className="font-mono text-xs font-black tracking-tight">
                                    キャンセル
                                  </span>
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* サブタスク表示モード - コンパクト化 */
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {/* 選択モード時のチェックボックス */}
                              {taskActions.isSubtaskSelectionMode && (
                                <button
                                  onClick={() =>
                                    taskActions.toggleSubtaskSelection(subtask.id)
                                  }
                                  className="shrink-0"
                                >
                                  {taskActions.selectedSubtaskIds.has(subtask.id) ? (
                                    <CheckSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                  ) : (
                                    <Square className="w-5 h-5 text-zinc-400" />
                                  )}
                                </button>
                              )}
                              {/* 並列実行ステータスアイコン */}
                              {!taskActions.isSubtaskSelectionMode &&
                              isParallelExecutionRunning &&
                              getSubtaskStatus(subtask.id) ? (
                                <SubtaskTitleIndicator
                                  executionStatus={getSubtaskStatus(subtask.id)}
                                  size="sm"
                                />
                              ) : (
                                !taskActions.isSubtaskSelectionMode && (
                                  <div className="shrink-0">
                                    {subtask.status === 'done' ? (
                                      <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                                        <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                      </div>
                                    ) : subtask.status === 'in-progress' ? (
                                      <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                                        <Circle className="w-3 h-3 text-blue-600 dark:text-blue-400 animate-pulse" />
                                      </div>
                                    ) : (
                                      <div className="w-5 h-5 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                                        <Circle className="w-3 h-3 text-zinc-400" />
                                      </div>
                                    )}
                                  </div>
                                )
                              )}
                              <span
                                className={`text-sm truncate ${subtask.status === 'done' ? 'text-zinc-400 line-through' : 'text-zinc-900 dark:text-zinc-50'}`}
                              >
                                {subtask.title}
                              </span>
                              <PriorityIcon
                                priority={subtask.priority}
                                size="sm"
                              />
                              {subtask.agentGenerated && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded shrink-0">
                                  <Bot className="w-3 h-3" />
                                  AI
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {(['todo', 'in-progress', 'done'] as const).map(
                                (status) => {
                                  const config = sharedStatusConfig[status];
                                  return (
                                    <TaskStatusChange
                                      key={status}
                                      status={status}
                                      currentStatus={subtask.status}
                                      config={config}
                                      renderIcon={renderStatusIcon}
                                      onClick={(newStatus) =>
                                        taskActions.updateStatus(subtask.id, newStatus)
                                      }
                                      size="sm"
                                    />
                                  );
                                },
                              )}
                              {/* 編集ボタン */}
                              <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 shadow-sm transition-all duration-300 hover:border-blue-500 dark:hover:border-blue-400">
                                <button
                                  onClick={() => taskActions.startEditingSubtask(subtask)}
                                  className="flex items-center justify-center text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-all cursor-pointer"
                                  title="編集"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Global Pomodoro Modal */}
      <GlobalPomodoroModal
        isOpen={showPomodoroModal}
        onClose={() => setShowPomodoroModal(false)}
        taskId={task?.id}
        taskTitle={task?.title}
      />

      {/* Developer Mode Config Modal */}
      <DeveloperModeConfigModal
        config={devModeConfig}
        isOpen={showDevModeConfig}
        onClose={() => setShowDevModeConfig(false)}
        onSave={updateDevModeConfig}
        selectedAgentConfigId={agentConfigId}
        onAgentConfigChange={setAgentConfigId}
        taskId={taskId}
      />

      {/* Save as Template Dialog */}
      {task && (
        <SaveAsTemplateDialog
          task={task}
          isOpen={showSaveTemplateDialog}
          onClose={() => setShowSaveTemplateDialog(false)}
          onSuccess={() => {
            alert('テンプレートとして保存しました');
          }}
        />
      )}

      {/* Plan Approval Modal */}
      {workflowFiles?.plan && (
        <PlanApprovalModal
          isOpen={showPlanApprovalModal}
          onClose={() => setShowPlanApprovalModal(false)}
          taskId={taskId}
          planFile={workflowFiles.plan}
          onApprovalComplete={handleApprovalComplete}
        />
      )}
    </div>
  );
}

// 認証が必要なコンポーネントとしてエクスポート
export default requireAuth(TaskDetailClient);
