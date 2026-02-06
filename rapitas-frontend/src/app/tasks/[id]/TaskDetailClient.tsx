"use client";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getLabelsArray } from "@/utils/labels";
import type { Task, TimeEntry, Comment, UserSettings, Resource } from "@/types";
import LabelSelector from "@/feature/tasks/components/LabelSelector";
import TaskStatusChange from "@/feature/tasks/components/TaskStatusChange";
import {
  statusConfig as sharedStatusConfig,
  renderStatusIcon,
} from "@/feature/tasks/config/StatusConfig";
import {
  Timer,
  Coffee,
  Pause,
  Hourglass,
  Clock,
  CheckCircle2,
  Circle,
  MessageSquare,
  Send,
  Trash2,
  Code,
  FileText,
  Tag,
  Save,
  Copy,
  ChevronDown,
  ChevronUp,
  Pencil,
  Check,
  X,
  FileStack,
  Bot,
  ArrowLeft,
  Loader2,
  CheckSquare,
  Square,
  StickyNote,
  Plus,
  CornerDownRight,
  Link2,
  Search,
} from "lucide-react";
import {
  SubtaskTitleIndicator,
  type ParallelExecutionStatus,
} from "@/feature/tasks/components/SubtaskExecutionStatus";
import { useParallelExecutionStatus } from "@/feature/tasks/hooks/useParallelExecutionStatus";
import { useSubtaskLogs } from "@/feature/tasks/hooks/useSubtaskLogs";
import { getTaskDetailPath } from "@/utils/tauri";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PomodoroTimer from "@/feature/tasks/components/PomodoroTimer";
import Button from "@/components/ui/button/Button";
import {
  usePomodoro,
  formatTime,
  getRemainingTime,
} from "@/feature/tasks/pomodoro/PomodoroProvider";
import { useDeveloperMode } from "@/feature/developer-mode/hooks/useDeveloperMode";
import CompactTaskDetailCard from "@/feature/tasks/components/CompactTaskDetailCard";
import { useApprovals } from "@/feature/developer-mode/hooks/useApprovals";
import { DeveloperModeConfigModal } from "@/feature/developer-mode/components/DeveloperModeConfig";
import { AIAccordionPanel } from "@/feature/developer-mode/components/AIAccordionPanel";
import SaveAsTemplateDialog from "@/feature/tasks/components/dialog/SaveAsTemplateDialog";
import DropdownMenu from "@/components/ui/dropdown/DropdownMenu";
import PriorityIcon from "@/feature/tasks/components/PriorityIcon";
import { API_BASE_URL } from "@/utils/api";

const API_BASE = API_BASE_URL;

const PROGRAMMING_LANGUAGES = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "csharp", label: "C#" },
  { value: "cpp", label: "C++" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
  { value: "sql", label: "SQL" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "bash", label: "Bash" },
  { value: "plaintext", label: "Plain Text" },
];

interface TaskDetailClientProps {
  taskId?: number;
  onTaskUpdated?: () => void;
  onClose?: () => void;
}

export default function TaskDetailClient({
  taskId: propTaskId,
  onTaskUpdated,
  onClose,
}: TaskDetailClientProps = {}) {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ページモード（ヘッダー表示フラグ）の確認
  const isPageMode = searchParams.get("showHeader") === "true";

  // TauriのiframeではuseParams()が正しく動作しない場合があるため、
  // window.locationからIDを直接抽出するフォールバックを追加
  const getTaskIdFromUrl = (): string | null => {
    if (typeof window === "undefined") return null;
    const match = window.location.pathname.match(/\/tasks\/(\d+)/);
    return match ? match[1] : null;
  };

  // propTaskIdを最優先、次にparams.id、最後にURLから直接取得
  const taskIdFromParams = params?.id as string | undefined;
  const taskIdFromUrl = getTaskIdFromUrl();
  const resolvedTaskId =
    propTaskId?.toString() || taskIdFromParams || taskIdFromUrl;

  // デバッグログ
  console.log("[TaskDetailClient] params:", params);
  console.log(
    "[TaskDetailClient] window.location:",
    typeof window !== "undefined" ? window.location.href : "SSR",
  );
  console.log("[TaskDetailClient] params.id:", params?.id);
  console.log("[TaskDetailClient] resolvedTaskId:", resolvedTaskId);

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // 編集フォーム用の状態
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editLabels, setEditLabels] = useState("");
  const [editLabelIds, setEditLabelIds] = useState<number[]>([]);
  const [editEstimatedHours, setEditEstimatedHours] = useState("");

  // コードブロック追加用の状態
  const [showCodeBlockDialog, setShowCodeBlockDialog] = useState(false);
  const [codeBlockLanguage, setCodeBlockLanguage] = useState("javascript");
  const [codeBlockContent, setCodeBlockContent] = useState("");
  const [isEditingCode, setIsEditingCode] = useState(false);
  const [originalCodeBlock, setOriginalCodeBlock] = useState<{
    language: string;
    code: string;
  } | null>(null);

  // 時間トラッキング用の状態
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);

  // コメント用の状態
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isAddingComment, setIsAddingComment] = useState(false);

  // リソース/添付ファイル用の状態
  const [resources, setResources] = useState<Resource[]>([]);

  // サブタスクアコーディオン用の状態
  const [isSubtasksExpanded, setIsSubtasksExpanded] = useState(true);

  // サブタスク編集用の状態
  const [editingSubtaskId, setEditingSubtaskId] = useState<number | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState("");
  const [editingSubtaskDescription, setEditingSubtaskDescription] =
    useState("");
  // サブタスク選択削除用の状態
  const [isSubtaskSelectionMode, setIsSubtaskSelectionMode] = useState(false);
  const [selectedSubtaskIds, setSelectedSubtaskIds] = useState<Set<number>>(
    new Set(),
  );
  const [showSubtaskDeleteConfirm, setShowSubtaskDeleteConfirm] = useState<
    "all" | "selected" | null
  >(null);

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

  // const {
  //   config: config,
  // } = useAIAnalysisMode(taskId);
  const {
    approve: approveRequest,
    reject: rejectRequest,
    isLoading: approvalLoading,
  } = useApprovals();
  const [pendingApprovalId, setPendingApprovalId] = useState<number | null>(
    null,
  );

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

  // サブタスクごとの実行ログ管理
  const subtasksForLogs = useMemo(() => {
    return (task?.subtasks || []).map((s) => ({ id: s.id, title: s.title }));
  }, [task?.subtasks]);

  const { subtaskLogs, refreshLogs: refreshSubtaskLogs } = useSubtaskLogs({
    sessionId: parallelSessionId,
    subtasks: subtasksForLogs,
    autoRefresh: isParallelExecutionRunning,
    pollingInterval: 2000,
  });

  useEffect(() => {
    const fetchTask = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
        if (!res.ok) throw new Error("タスクの取得に失敗しました");
        const data = await res.json();
        setTask(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
      } finally {
        setLoading(false);
      }
    };

    const fetchTimeEntries = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/tasks/${resolvedTaskId}/time-entries`,
        );
        if (res.ok) setTimeEntries(await res.json());
      } catch (err) {
        console.error("Failed to fetch time entries:", err);
      }
    };

    const fetchComments = async () => {
      try {
        const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}/comments`);
        if (res.ok) setComments(await res.json());
      } catch (err) {
        console.error("Failed to fetch comments:", err);
      }
    };

    const fetchResources = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/tasks/${resolvedTaskId}/resources`,
        );
        if (res.ok) setResources(await res.json());
      } catch (err) {
        console.error("Failed to fetch resources:", err);
      }
    };

    const fetchGlobalSettings = async () => {
      try {
        const res = await fetch(`${API_BASE}/settings`);
        if (res.ok) {
          const data = await res.json();
          setGlobalSettings(data);
          // グローバル設定からAIアシスタントパネルを初期化
          if (data.aiTaskAnalysisDefault) {
            setShowAIAssistant(true);
          }
        }
      } catch (err) {
        console.error("Failed to fetch global settings:", err);
      }
    };

    if (resolvedTaskId) {
      fetchTask();
      fetchTimeEntries();
      fetchComments();
      fetchResources();
      fetchDevModeConfig();
      fetchAgents();
      fetchGlobalSettings();
    }
  }, [resolvedTaskId, fetchDevModeConfig, fetchAgents]);

  // グローバル設定に基づいて開発者モードを自動有効化（開発プロジェクトかつAIアシスタント有効の場合）
  useEffect(() => {
    const autoEnableDeveloperMode = async () => {
      // グローバル設定がロードされ、AIアシスタントがデフォルト有効で、開発プロジェクトで、まだ有効化されていない場合
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

  const updateStatus = async (taskId: number, newStatus: string) => {
    // タスク完了時にオーバーレイを表示
    if (newStatus === "done") {
      setShowCompleteOverlay(true);
    }

    // 楽観的UI更新: APIレスポンスを待たずに即座にUIを更新
    const previousTask = task;
    setTask((prev) => {
      if (!prev) return prev;
      // メインタスクのステータス更新
      if (prev.id === taskId) {
        return { ...prev, status: newStatus as Task["status"] };
      }
      // サブタスクのステータス更新
      if (prev.subtasks) {
        const updatedSubtasks = prev.subtasks.map((subtask) =>
          subtask.id === taskId
            ? { ...subtask, status: newStatus as Task["status"] }
            : subtask,
        );
        return { ...prev, subtasks: updatedSubtasks };
      }
      return prev;
    });

    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        // エラー時は元の状態に戻す
        setTask(previousTask);
        throw new Error("ステータス更新に失敗しました");
      }
    } catch (err) {
      console.error(err);
      // エラー時は元の状態に戻す
      setTask(previousTask);
    }
  };

  const insertCodeBlock = () => {
    if (isEditingCode && originalCodeBlock) {
      const oldBlock = `\`\`\`${originalCodeBlock.language}\n${originalCodeBlock.code}\n\`\`\``;
      const newBlock = `\`\`\`${codeBlockLanguage}\n${codeBlockContent}\n\`\`\``;
      setEditDescription(editDescription.replace(oldBlock, newBlock));
    } else {
      const codeBlock = `\n\`\`\`${codeBlockLanguage}\n${codeBlockContent}\n\`\`\`\n`;
      setEditDescription(editDescription + codeBlock);
    }
    setCodeBlockContent("");
    setCodeBlockLanguage("javascript");
    setShowCodeBlockDialog(false);
    setIsEditingCode(false);
    setOriginalCodeBlock(null);
  };

  const handleEditCode = (language: string, code: string) => {
    setIsEditingCode(true);
    setOriginalCodeBlock({ language, code });
    setCodeBlockLanguage(language);
    setCodeBlockContent(code);
    setShowCodeBlockDialog(true);
  };

  const handleAddComment = async (content?: string, parentId?: number) => {
    const commentContent = content || newComment;
    if (!commentContent.trim()) return;

    try {
      setIsAddingComment(true);
      const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: commentContent, parentId }),
      });

      if (res.ok) {
        // コメント一覧を再取得してツリー構造を更新
        const commentsRes = await fetch(
          `${API_BASE}/tasks/${resolvedTaskId}/comments`,
        );
        if (commentsRes.ok) {
          setComments(await commentsRes.json());
        }
        // メインのコメント入力をクリア（返信の場合は content が渡されるので newComment はクリアしない）
        if (!content) {
          setNewComment("");
        }
      }
    } catch (err) {
      console.error("Failed to add comment:", err);
    } finally {
      setIsAddingComment(false);
    }
  };

  const handleUpdateComment = useCallback(
    async (commentId: number, content: string) => {
      try {
        const res = await fetch(`${API_BASE}/comments/${commentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (res.ok) {
          const updatedComment = await res.json();
          setComments((prev) =>
            prev.map((c) => (c.id === commentId ? updatedComment : c)),
          );
        }
      } catch (err) {
        console.error("Failed to update comment:", err);
      }
    },
    [],
  );

  const handleDeleteComment = async (commentId: number) => {
    if (!confirm("このコメントを削除しますか?")) return;

    try {
      const res = await fetch(`${API_BASE}/comments/${commentId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setComments(comments.filter((c) => c.id !== commentId));
      }
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  };

  const handleCreateCommentLink = useCallback(
    async (fromCommentId: number, toCommentId: number, label?: string) => {
      try {
        const res = await fetch(`${API_BASE}/comments/${fromCommentId}/links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toCommentId, label }),
        });
        if (res.ok) {
          // Refresh comments to show new link
          const commentsRes = await fetch(
            `${API_BASE}/tasks/${resolvedTaskId}/comments`,
          );
          if (commentsRes.ok) {
            setComments(await commentsRes.json());
          }
        }
      } catch (err) {
        console.error("Failed to create comment link:", err);
      }
    },
    [resolvedTaskId],
  );

  const handleDeleteCommentLink = useCallback(
    async (linkId: number) => {
      try {
        const res = await fetch(`${API_BASE}/comment-links/${linkId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          // Refresh comments to reflect removed link
          const commentsRes = await fetch(
            `${API_BASE}/tasks/${resolvedTaskId}/comments`,
          );
          if (commentsRes.ok) {
            setComments(await commentsRes.json());
          }
        }
      } catch (err) {
        console.error("Failed to delete comment link:", err);
      }
    },
    [resolvedTaskId],
  );

  const startEditing = () => {
    if (!task) return;
    setEditTitle(task.title);
    setEditDescription(task.description || "");
    setEditStatus(task.status);
    setEditLabels(getLabelsArray(task.labels).join(", "));
    setEditLabelIds(task.taskLabels?.map((tl) => tl.labelId) || []);
    setEditEstimatedHours(task.estimatedHours?.toString() || "");
    setIsEditing(true);
  };

  const cancelEditing = () => setIsEditing(false);

  const saveTask = async () => {
    if (!task || !editTitle.trim()) return;

    try {
      const labelArray = editLabels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);

      const res = await fetch(`${API_BASE}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription || undefined,
          status: editStatus,
          labels: labelArray.length > 0 ? labelArray : undefined,
          labelIds: editLabelIds,
          estimatedHours: editEstimatedHours
            ? parseFloat(editEstimatedHours)
            : undefined,
        }),
      });

      if (!res.ok) throw new Error("更新に失敗しました");
      const updated = await res.json();
      setTask(updated);
      setIsEditing(false);
    } catch (err) {
      console.error(err);
      alert("タスクの更新に失敗しました");
    }
  };

  const deleteTask = async () => {
    if (!confirm("このタスクを削除しますか?")) return;

    try {
      const res = await fetch(`${API_BASE}/tasks/${task?.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("削除に失敗しました");

      // このタスクのタイマーが動作中なら停止
      if (isThisTaskTimer && pomodoroState.isTimerRunning) {
        stopTimer();
      }

      // ポモドーロモーダルを閉じる
      setShowPomodoroModal(false);

      // 前のページに戻る
      router.back();
    } catch (err) {
      console.error(err);
      alert("タスクの削除に失敗しました");
    }
  };

  // AI分析の実行
  const handleAnalyze = async () => {
    const result = await analyzeTask();
    if (result?.approvalRequestId) {
      setPendingApprovalId(result.approvalRequestId);
    }
    // 自動承認の場合は、タスクを再取得
    if (result?.autoApproved) {
      const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
      if (res.ok) {
        setTask(await res.json());
      }
    }
  };

  // 承認
  const handleApproveAnalysis = async (arg?: number | number[]) => {
    // arg may be approvalId (number) when called from AIAnalysisPanel
    // or selectedSubtasks (number[]) when called locally.
    const approvalId = typeof arg === "number" ? arg : pendingApprovalId;
    const selectedSubtasks = Array.isArray(arg) ? arg : undefined;
    if (!approvalId) return;
    const result = await approveRequest(approvalId, selectedSubtasks);
    if (result?.success) {
      setAnalysisResult(null);
      setPendingApprovalId(null);
      // タスクを再取得してサブタスクを表示
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

  // サブタスク編集開始
  const startEditingSubtask = (subtask: Task) => {
    setEditingSubtaskId(subtask.id);
    setEditingSubtaskTitle(subtask.title);
    setEditingSubtaskDescription(subtask.description || "");
  };

  // サブタスク編集キャンセル
  const cancelEditingSubtask = () => {
    setEditingSubtaskId(null);
    setEditingSubtaskTitle("");
    setEditingSubtaskDescription("");
  };

  // サブタスク更新
  const updateSubtask = async (
    subtaskId: number,
    data: { title?: string; description?: string },
  ) => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${subtaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("サブタスクの更新に失敗しました");

      // タスクを再取得してサブタスクを更新
      const taskRes = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
      if (taskRes.ok) {
        setTask(await taskRes.json());
      }
      cancelEditingSubtask();
    } catch (err) {
      console.error(err);
      alert("サブタスクの更新に失敗しました");
    }
  };

  // サブタスク編集保存
  const saveSubtaskEdit = () => {
    if (editingSubtaskId && editingSubtaskTitle.trim()) {
      updateSubtask(editingSubtaskId, {
        title: editingSubtaskTitle,
        description: editingSubtaskDescription || undefined,
      });
    }
  };

  // サブタスク選択モードの切り替え
  const toggleSubtaskSelectionMode = () => {
    if (isSubtaskSelectionMode) {
      setSelectedSubtaskIds(new Set());
    }
    setIsSubtaskSelectionMode(!isSubtaskSelectionMode);
  };

  // サブタスクの選択を切り替え
  const toggleSubtaskSelection = (subtaskId: number) => {
    setSelectedSubtaskIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(subtaskId)) {
        newSet.delete(subtaskId);
      } else {
        newSet.add(subtaskId);
      }
      return newSet;
    });
  };

  // 全サブタスクを選択
  const selectAllSubtasks = () => {
    if (task?.subtasks) {
      setSelectedSubtaskIds(new Set(task.subtasks.map((s) => s.id)));
    }
  };

  // 全サブタスクの選択を解除
  const deselectAllSubtasks = () => {
    setSelectedSubtaskIds(new Set());
  };

  // 選択したサブタスクを削除
  const handleDeleteSelectedSubtasks = async () => {
    if (selectedSubtaskIds.size > 0) {
      await deleteSelectedSubtasks(Array.from(selectedSubtaskIds));
      setSelectedSubtaskIds(new Set());
      setIsSubtaskSelectionMode(false);
      setShowSubtaskDeleteConfirm(null);
    }
  };

  // 全サブタスクを削除
  const handleDeleteAllSubtasks = async () => {
    await deleteAllSubtasks();
    setShowSubtaskDeleteConfirm(null);
  };

  // タスクを再取得するヘルパー関数
  const refetchTask = async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
      if (res.ok) {
        const data = await res.json();
        setTask(data);
      }
    } catch (err) {
      console.error("Failed to refetch task:", err);
    }
  };

  // サブタスク一括削除
  const deleteAllSubtasks = async () => {
    if (!task) return;

    try {
      const res = await fetch(`${API_BASE}/tasks/${task.id}/subtasks`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("削除に失敗しました");

      const result = await res.json();
      console.log(
        `[TaskDetail] Deleted all subtasks: ${result.deletedCount} items`,
      );

      // タスクを再取得
      await refetchTask();
      onTaskUpdated?.();
    } catch (err) {
      console.error(err);
      alert("サブタスクの削除に失敗しました");
    }
  };

  // サブタスク選択削除
  const deleteSelectedSubtasks = async (subtaskIds: number[]) => {
    if (!task || subtaskIds.length === 0) return;

    try {
      const res = await fetch(
        `${API_BASE}/tasks/${task.id}/subtasks/delete-selected`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subtaskIds }),
        },
      );

      if (!res.ok) throw new Error("削除に失敗しました");

      const result = await res.json();
      console.log(
        `[TaskDetail] Deleted selected subtasks: ${result.deletedCount} items`,
      );

      // タスクを再取得
      await refetchTask();
      onTaskUpdated?.();
    } catch (err) {
      console.error(err);
      alert("サブタスクの削除に失敗しました");
    }
  };

  // 単一サブタスク削除
  const deleteSubtask = async (subtaskId: number) => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${subtaskId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("削除に失敗しました");

      // タスクを再取得
      await refetchTask();
      onTaskUpdated?.();
    } catch (err) {
      console.error(err);
      alert("サブタスクの削除に失敗しました");
    }
  };

  const duplicateTask = async () => {
    if (!task) return;

    try {
      const duplicateData = {
        title: `${task.title} (コピー)`,
        description: task.description || undefined,
        status: "todo",
        labels: task.labels || undefined,
        labelIds: task.taskLabels?.map((tl) => tl.labelId) || [],
        estimatedHours: task.estimatedHours || undefined,
        dueDate: task.dueDate || undefined,
        projectId: task.projectId || undefined,
        milestoneId: task.milestoneId || undefined,
        themeId: task.themeId || undefined,
      };

      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(duplicateData),
      });

      if (!res.ok) throw new Error("複製に失敗しました");

      const newTask = await res.json();
      router.push(getTaskDetailPath(newTask.id));
    } catch (err) {
      console.error(err);
      alert("タスクの複製に失敗しました");
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="h-[calc(100vh-5rem)] overflow-auto bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 flex items-center justify-center scrollbar-thin">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">
            読み込み中...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !task) {
    return (
      <div className="h-[calc(100vh-5rem)] overflow-auto bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 flex items-center justify-center scrollbar-thin">
        <div className="text-center bg-white dark:bg-indigo-dark-900 rounded-2xl p-8 shadow-xl border border-zinc-200 dark:border-zinc-800">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <span className="text-3xl">!</span>
          </div>
          <p className="text-red-600 dark:text-red-400 mb-4 font-medium">
            {error || "タスクが見つかりません"}
          </p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium"
          >
            ホームに戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-linear-to-br from-zinc-50 via-white to-violet-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-violet-950/10 scrollbar-thin">
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
            {!isEditing && (
              <button
                onClick={() => setShowPomodoroModal(true)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
                  isThisTaskTimer && pomodoroState.isTimerRunning
                    ? pomodoroState.isBreakTime
                      ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                      : pomodoroState.isPaused
                        ? "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-orange-300 border border-orange-200 dark:border-amber-800"
                        : "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                    : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:border-gray-300 dark:hover:border-gray-700"
                }`}
              >
                {isThisTaskTimer && pomodoroState.isTimerRunning ? (
                  pomodoroState.isBreakTime ? (
                    <Coffee className="w-4 h-4" />
                  ) : pomodoroState.isPaused ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Hourglass className="w-4 h-4 animate-pulse" />
                  )
                ) : (
                  <Timer className="w-4 h-4" />
                )}
                時間管理
                {isThisTaskTimer && pomodoroState.isTimerRunning && (
                  <span className="font-mono tabular-nums text-xs bg-white/50 dark:bg-black/20 px-2 py-0.5 rounded-md">
                    {formatTime(getRemainingTime(pomodoroState))}
                  </span>
                )}
              </button>
            )}

            {!isEditing ? (
              <>
                <Button
                  onClick={startEditing}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl hover:border-gray-300 dark:hover:border-gray-700 transition-all"
                >
                  <Pencil className="w-4 h-4" />
                  編集
                </Button>
                <DropdownMenu
                  items={[
                    {
                      label: "複製",
                      icon: <Copy className="w-4 h-4" />,
                      onClick: duplicateTask,
                    },
                    {
                      label: "テンプレート保存",
                      icon: <FileStack className="w-4 h-4" />,
                      onClick: () => setShowSaveTemplateDialog(true),
                    },
                    {
                      label: "削除",
                      icon: <Trash2 className="w-4 h-4" />,
                      onClick: deleteTask,
                      variant: "danger",
                    },
                  ]}
                />
              </>
            ) : (
              <>
                <button
                  onClick={saveTask}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-lg transition-colors"
                >
                  <Save className="w-4 h-4" />
                  保存
                </button>
                <button
                  onClick={cancelEditing}
                  className="px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
                >
                  キャンセル
                </button>
              </>
            )}
          </div>
        </div>

        {isEditing ? (
          /* Edit Mode */
          <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
            {/* Title Input with Status */}
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <input
                  type="text"
                  className="flex-1 min-w-0 text-2xl font-bold bg-transparent border-none outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="タスクのタイトル"
                />
                <div className="flex items-center gap-1 shrink-0">
                  {(["todo", "in-progress", "done"] as const).map((status) => {
                    const config = sharedStatusConfig[status];
                    return (
                      <TaskStatusChange
                        key={status}
                        status={status}
                        currentStatus={editStatus}
                        config={config}
                        renderIcon={renderStatusIcon}
                        onClick={(newStatus: string) =>
                          setEditStatus(newStatus)
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
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                  <FileText className="w-4 h-4" />
                  <span className="text-sm font-medium">説明</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCodeBlockDialog(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  <Code className="w-3.5 h-3.5" />
                  コード追加
                </button>
              </div>
              <textarea
                className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-3 text-sm border-none outline-none resize-none focus:ring-2 focus:ring-violet-500/20 transition-all font-mono min-h-[200px]"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
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
                selectedLabelIds={editLabelIds}
                onChange={setEditLabelIds}
              />
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
                  value={editEstimatedHours}
                  onChange={(e) => setEditEstimatedHours(e.target.value)}
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
                onStatusUpdate={updateStatus}
                onEditCode={handleEditCode}
                resources={resources}
                onResourcesChange={async () => {
                  const res = await fetch(
                    `${API_BASE}/tasks/${resolvedTaskId}/resources`,
                  );
                  if (res.ok) setResources(await res.json());
                }}
                // メモ関連のprops
                comments={comments}
                newComment={newComment}
                isAddingComment={isAddingComment}
                onNewCommentChange={setNewComment}
                onAddComment={handleAddComment}
                onUpdateComment={handleUpdateComment}
                onDeleteComment={handleDeleteComment}
                onCreateLink={handleCreateCommentLink}
                onDeleteLink={handleDeleteCommentLink}
              />
            </div>

            {/* AI アシスタント統合パネル（タスク分析 + プロンプト最適化 + エージェント実行） */}
            {/* 開発プロジェクトかつAIアシスタント設定が有効な場合に表示 */}
            {task.theme?.isDevelopment === true && showAIAssistant && (
              <div className="mb-6">
                <AIAccordionPanel
                  taskId={taskId}
                  taskTitle={task.title}
                  taskDescription={task.description}
                  config={devModeConfig}
                  onOpenSettings={() => setShowDevModeConfig(true)}
                  // AI分析関連
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
                    // タスクを再取得してサブタスクを更新
                    const res = await fetch(
                      `${API_BASE}/tasks/${resolvedTaskId}`,
                    );
                    if (res.ok) {
                      const data = await res.json();
                      setTask(data);
                    }
                  }}
                  // エージェント実行関連（開発者モードが有効なら表示）
                  showAgentPanel={devModeConfig?.isEnabled === true}
                  isExecuting={isExecuting}
                  executionStatus={executionStatus}
                  executionResult={executionResult}
                  executionError={executionResult?.error || null}
                  workingDirectory={task.theme?.workingDirectory || undefined}
                  defaultBranch={task.theme?.defaultBranch || "main"}
                  useTaskAnalysis={!!analysisResult}
                  optimizedPrompt={optimizedPrompt}
                  resources={resources}
                  agentConfigId={agentConfigId}
                  agents={agents}
                  onAgentChange={setAgentConfigId}
                  onExecute={executeAgent}
                  onReset={resetExecutionState}
                  onRestoreExecutionState={restoreExecutionState}
                  onStopExecution={setExecutionCancelled}
                  // 並列実行関連
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
                          task.subtasks.filter((s) => s.status === "done")
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
                              width: `${Math.round((task.subtasks.filter((s) => s.status === "done").length / task.subtasks.length) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-zinc-500">
                          {Math.round(
                            (task.subtasks.filter((s) => s.status === "done")
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
                          toggleSubtaskSelectionMode();
                        }}
                        className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg transition-colors ${
                          isSubtaskSelectionMode
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                            : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                      >
                        {isSubtaskSelectionMode ? (
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
                      {isSubtaskSelectionMode && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              selectedSubtaskIds.size === task.subtasks!.length
                                ? deselectAllSubtasks()
                                : selectAllSubtasks();
                            }}
                            className="px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                          >
                            {selectedSubtaskIds.size === task.subtasks!.length
                              ? "全解除"
                              : "全選択"}
                          </button>
                          {selectedSubtaskIds.size > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowSubtaskDeleteConfirm("selected");
                              }}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              {selectedSubtaskIds.size}件削除
                            </button>
                          )}
                        </>
                      )}
                      {/* 一括削除ボタン */}
                      {!isSubtaskSelectionMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowSubtaskDeleteConfirm("all");
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          全削除
                        </button>
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
                {showSubtaskDeleteConfirm && (
                  <div className="p-4 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800">
                    <p className="text-sm text-red-700 dark:text-red-300 mb-3">
                      {showSubtaskDeleteConfirm === "all"
                        ? `すべてのサブタスク（${task.subtasks.length}件）を削除しますか？この操作は取り消せません。`
                        : `選択した${selectedSubtaskIds.size}件のサブタスクを削除しますか？この操作は取り消せません。`}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={
                          showSubtaskDeleteConfirm === "all"
                            ? handleDeleteAllSubtasks
                            : handleDeleteSelectedSubtasks
                        }
                        className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                      >
                        削除する
                      </button>
                      <button
                        onClick={() => setShowSubtaskDeleteConfirm(null)}
                        className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}
                {isSubtasksExpanded && (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {task.subtasks.map((subtask) => (
                      <div
                        key={subtask.id}
                        className={`p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors ${
                          isSubtaskSelectionMode &&
                          selectedSubtaskIds.has(subtask.id)
                            ? "bg-blue-50 dark:bg-blue-950/20 ring-1 ring-blue-500 dark:ring-blue-400"
                            : ""
                        }`}
                      >
                        {editingSubtaskId === subtask.id ? (
                          /* サブタスク編集モード */
                          <div className="space-y-3">
                            <input
                              type="text"
                              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={editingSubtaskTitle}
                              onChange={(e) =>
                                setEditingSubtaskTitle(e.target.value)
                              }
                              placeholder="サブタスクタイトル"
                              autoFocus
                            />
                            <textarea
                              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={editingSubtaskDescription}
                              onChange={(e) =>
                                setEditingSubtaskDescription(e.target.value)
                              }
                              placeholder="説明（マークダウン対応）"
                              rows={3}
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={saveSubtaskEdit}
                                disabled={!editingSubtaskTitle.trim()}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                              >
                                <Check className="w-4 h-4" />
                                保存
                              </button>
                              <button
                                onClick={cancelEditingSubtask}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                              >
                                <X className="w-4 h-4" />
                                キャンセル
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* サブタスク表示モード - コンパクト化 */
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {/* 選択モード時のチェックボックス */}
                              {isSubtaskSelectionMode && (
                                <button
                                  onClick={() =>
                                    toggleSubtaskSelection(subtask.id)
                                  }
                                  className="shrink-0"
                                >
                                  {selectedSubtaskIds.has(subtask.id) ? (
                                    <CheckSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                  ) : (
                                    <Square className="w-5 h-5 text-zinc-400" />
                                  )}
                                </button>
                              )}
                              {/* 並列実行ステータスアイコン（実行中の場合） */}
                              {!isSubtaskSelectionMode &&
                              isParallelExecutionRunning &&
                              getSubtaskStatus(subtask.id) ? (
                                <SubtaskTitleIndicator
                                  executionStatus={getSubtaskStatus(subtask.id)}
                                  size="sm"
                                />
                              ) : (
                                !isSubtaskSelectionMode && (
                                  /* 通常のステータスアイコン */
                                  <div className="shrink-0">
                                    {subtask.status === "done" ? (
                                      <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                                        <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                      </div>
                                    ) : subtask.status === "in-progress" ? (
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
                                className={`text-sm truncate ${subtask.status === "done" ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-zinc-50"}`}
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
                              {/* ステータス変更ボタン（コンパクト版） */}
                              {(["todo", "in-progress", "done"] as const).map(
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
                                        updateStatus(subtask.id, newStatus)
                                      }
                                      size="sm"
                                    />
                                  );
                                },
                              )}
                              {/* 編集ボタン */}
                              <button
                                onClick={() => startEditingSubtask(subtask)}
                                className="w-6 h-6 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                                title="編集"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
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

      {/* Pomodoro Modal */}
      {!isEditing && task && (
        <div
          className={`fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-opacity ${showPomodoroModal ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          onClick={() => setShowPomodoroModal(false)}
        >
          <div
            className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-4xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white dark:bg-indigo-dark-900 border-b border-zinc-200 dark:border-zinc-800 p-5 flex items-center hover:border-gray-300 dark:hover:border-gray-700 justify-between">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                <Timer className="w-5 h-5 text-blue-500" />
                時間管理
              </h2>
              <button
                onClick={() => setShowPomodoroModal(false)}
                className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <PomodoroTimer
                taskId={task.id}
                taskTitle={task.title}
                estimatedHours={task.estimatedHours ?? undefined}
                actualHours={task.actualHours ?? undefined}
                timeEntries={timeEntries}
                onUpdate={() => {
                  fetch(`${API_BASE}/tasks/${resolvedTaskId}`)
                    .then((res) => res.json())
                    .then((data) => setTask(data));
                  fetch(`${API_BASE}/tasks/${resolvedTaskId}/time-entries`)
                    .then((res) => res.json())
                    .then((data) => setTimeEntries(data));
                }}
                showTaskTitle={false}
              />
            </div>
          </div>
        </div>
      )}

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

      {/* Code Block Dialog */}
      {showCodeBlockDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-3xl max-h-[90vh] overflow-auto">
            <div className="p-6">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mb-6 flex items-center gap-2">
                <Code className="w-5 h-5 text-violet-500" />
                {isEditingCode
                  ? "コードブロックを編集"
                  : "コードブロックを追加"}
              </h3>

              <div className="mb-4">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  言語
                </label>
                <select
                  value={codeBlockLanguage}
                  onChange={(e) => setCodeBlockLanguage(e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-2.5 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20"
                >
                  {PROGRAMMING_LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  コード
                </label>
                <textarea
                  value={codeBlockContent}
                  onChange={(e) => setCodeBlockContent(e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 font-mono"
                  rows={12}
                  placeholder="コードを入力..."
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={insertCodeBlock}
                  disabled={!codeBlockContent.trim()}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-violet-600 rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isEditingCode ? "更新" : "挿入"}
                </button>
                <button
                  onClick={() => {
                    setShowCodeBlockDialog(false);
                    setCodeBlockContent("");
                    setCodeBlockLanguage("javascript");
                    setIsEditingCode(false);
                    setOriginalCodeBlock(null);
                  }}
                  className="px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save as Template Dialog */}
      {task && (
        <SaveAsTemplateDialog
          task={task}
          isOpen={showSaveTemplateDialog}
          onClose={() => setShowSaveTemplateDialog(false)}
          onSuccess={() => {
            // テンプレート保存成功時の通知（任意）
            alert("テンプレートとして保存しました");
          }}
        />
      )}
    </div>
  );
}
