"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type {
  Task,
  TimeEntry,
  Comment,
  Label,
  DeveloperModeConfig,
} from "@/types";
import LabelSelector, {
  SelectedLabelsDisplay,
} from "@/feature/tasks/components/LabelSelector";
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
  Calendar,
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
  BrainCircuit,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createMarkdownComponents } from "@/feature/tasks/components/MarkdownComponents";
import PomodoroTimer from "@/feature/tasks/components/PomodoroTimer";
import Button from "@/components/ui/button/Button";
import {
  usePomodoro,
  formatTime,
  getRemainingTime,
} from "@/feature/tasks/pomodoro/PomodoroProvider";
import { useDeveloperMode } from "@/feature/developer-mode/hooks/useDeveloperMode";
import { useApprovals } from "@/feature/developer-mode/hooks/useApprovals";
import { ToggleButton } from "@/components/ui/button/ToggleButton";
import { DeveloperModeConfigModal } from "@/feature/developer-mode/components/DeveloperModeConfig";
import { AgentExecutionPanel } from "@/feature/developer-mode/components/AgentExecutionPanel";
import { AIAnalysisPanel } from "@/feature/developer-mode/components/AIAnalysisPanel";
import { Bot } from "lucide-react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";


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

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

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
  const [isCommentsExpanded, setIsCommentsExpanded] = useState(false);

  // ポモドーロモーダル用の状態
  const [showPomodoroModal, setShowPomodoroModal] = useState(false);
  const { state: pomodoroState, stopTimer } = usePomodoro();

  const isThisTaskTimer = pomodoroState.taskId === task?.id;

  // 開発者モード用の状態
  const [showDevModeConfig, setShowDevModeConfig] = useState(false);
  const taskId = params.id ? parseInt(params.id as string) : 0;
  const {
    config: devModeConfig,
    isLoading: devModeLoading,
    isAnalyzing,
    isExecuting,
    executionStatus,
    executionResult,
    analysisResult,
    analysisApprovalId,
    error: devModeError,
    analysisError,
    fetchConfig: fetchDevModeConfig,
    enableDeveloperMode,
    disableDeveloperMode,
    updateConfig: updateDevModeConfig,
    analyzeTask,
    setAnalysisResult,
    executeAgent,
    resetExecutionState,
    restoreExecutionState,
    approveSubtaskCreation,
    setExecutionCancelled,
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

  // AIタスク分析モードの状態（localStorageからグローバルに保持）
  const [showTaskAnalysis, setShowTaskAnalysis] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("showTaskAnalysis");
      return saved === "true";
    }
    return false;
  });

  // showTaskAnalysis の変更時にlocalStorageに保存
  useEffect(() => {
    localStorage.setItem("showTaskAnalysis", String(showTaskAnalysis));
  }, [showTaskAnalysis]);

  // 最適化されたプロンプト用の状態
  const [optimizedPrompt, setOptimizedPrompt] = useState<string | null>(null);

  useEffect(() => {
    const fetchTask = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/tasks/${params.id}`);
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
        const res = await fetch(`${API_BASE}/tasks/${params.id}/time-entries`);
        if (res.ok) setTimeEntries(await res.json());
      } catch (err) {
        console.error("Failed to fetch time entries:", err);
      }
    };

    const fetchComments = async () => {
      try {
        const res = await fetch(`${API_BASE}/tasks/${params.id}/comments`);
        if (res.ok) setComments(await res.json());
      } catch (err) {
        console.error("Failed to fetch comments:", err);
      }
    };

    if (params.id) {
      fetchTask();
      fetchTimeEntries();
      fetchComments();
      fetchDevModeConfig();
    }
  }, [params.id, fetchDevModeConfig]);

  const updateStatus = async (taskId: number, newStatus: string) => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("ステータス更新に失敗しました");

      setTask((prev) => {
        if (!prev) return prev;
        if (prev.id === taskId) {
          return { ...prev, status: newStatus as Task["status"] };
        }
        return prev;
      });
    } catch (err) {
      console.error(err);
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

  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    try {
      setIsAddingComment(true);
      const res = await fetch(`${API_BASE}/tasks/${params.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newComment }),
      });

      if (res.ok) {
        const comment = await res.json();
        setComments([...comments, comment]);
        setNewComment("");
      }
    } catch (err) {
      console.error("Failed to add comment:", err);
    } finally {
      setIsAddingComment(false);
    }
  };

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

  const startEditing = () => {
    if (!task) return;
    setEditTitle(task.title);
    setEditDescription(task.description || "");
    setEditStatus(task.status);
    setEditLabels(task.labels?.join(", ") || "");
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

  // 開発者モードのトグル
  const handleToggleDeveloperMode = async () => {
    if (devModeConfig?.isEnabled) {
      await disableDeveloperMode();
      setTask((prev) => (prev ? { ...prev, isDeveloperMode: false } : prev));
    } else {
      await enableDeveloperMode();
      setTask((prev) => (prev ? { ...prev, isDeveloperMode: true } : prev));
    }
  };

  const handleToggleAIAnalysisMode = async () => {};

  // AI分析の実行
  const handleAnalyze = async () => {
    const result = await analyzeTask();
    if (result?.approvalRequestId) {
      setPendingApprovalId(result.approvalRequestId);
    }
    // 自動承認の場合は、タスクを再取得
    if (result?.autoApproved) {
      const res = await fetch(`${API_BASE}/tasks/${params.id}`);
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
        const res = await fetch(`${API_BASE}/tasks/${params.id}`);
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
      router.push(`/tasks/${newTask.id}`);
    } catch (err) {
      console.error(err);
      alert("タスクの複製に失敗しました");
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 flex items-center justify-center">
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
      <div className="min-h-screen bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 flex items-center justify-center">
        <div className="text-center bg-white dark:bg-zinc-900 rounded-2xl p-8 shadow-xl border border-zinc-200 dark:border-zinc-800">
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

  const currentStatus = sharedStatusConfig[task.status as keyof typeof sharedStatusConfig];

  return (
    <div className="min-h-screen bg-linear-to-br from-zinc-50 via-white to-violet-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-violet-950/10">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header Actions */}
        <div className="mb-6 flex items-center justify-end gap-2">
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
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
                編集
              </Button>
              <button
                onClick={duplicateTask}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl hover:border-gray-300 dark:hover:border-gray-700 transition-all"
              >
                <Copy className="w-4 h-4" />
                複製
              </button>
              <button
                onClick={deleteTask}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                削除
              </button>
            </>
          ) : (
            <>
              <Button
                onClick={saveTask}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-500 shadow-lg transition-all"
              >
                <Save className="w-4 h-4" />
                保存
              </Button>
              <button
                onClick={cancelEditing}
                className="px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
              >
                キャンセル
              </button>
            </>
          )}
        </div>

        {isEditing ? (
          /* Edit Mode */
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
            {/* Title Input */}
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
              <input
                type="text"
                className="w-full text-2xl font-bold bg-transparent border-none outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="タスクのタイトル"
              />
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

            {/* Status */}
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-3">
                <Circle className="w-4 h-4" />
                <span className="text-sm font-medium">ステータス</span>
              </div>
              <div className="flex gap-2">
                {(["todo", "in-progress", "done"] as const).map((status) => {
                  const config = sharedStatusConfig[status];
                  return (
                    <TaskStatusChange
                      key={status}
                      status={status}
                      currentStatus={editStatus}
                      config={config}
                      renderIcon={renderStatusIcon}
                      onClick={(status: string) => setEditStatus(status)}
                      size="lg"
                      showLabel={true}
                    />
                  );
                })}
              </div>
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
            {/* Main Card */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden mb-6">
              {/* Title & Status */}
              <div className="p-8 pb-6">
                <div className="flex items-start justify-between gap-4 mb-6">
                  <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 leading-tight">
                    {task.title}
                  </h1>
                </div>

                {/* Status Buttons */}
                <div className="flex gap-2">
                  {(["todo", "in-progress", "done"] as const).map((status) => {
                    const config = sharedStatusConfig[status];
                    return (
                      <TaskStatusChange
                        key={status}
                        status={status}
                        currentStatus={task.status}
                        config={config}
                        renderIcon={renderStatusIcon}
                        onClick={(status: string) => updateStatus(task.id, status)}
                        size="lg"
                        showLabel={true}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Meta Info */}
              {(task.taskLabels?.length || task.estimatedHours) && (
                <div className="px-8 pb-6 flex flex-wrap items-center gap-4">
                  {task.taskLabels && task.taskLabels.length > 0 && (
                    <SelectedLabelsDisplay
                      labels={task.taskLabels
                        .map((tl) => tl.label)
                        .filter((l): l is Label => l !== undefined)}
                    />
                  )}
                  {task.estimatedHours && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-sm font-medium">
                      <Clock className="w-3.5 h-3.5" />
                      {task.estimatedHours}時間
                    </div>
                  )}
                </div>
              )}

              {/* Description */}
              {task.description && (
                <div className="px-8 pb-8">
                  <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-6">
                    <div
                      className="prose prose-zinc dark:prose-invert max-w-none
                      prose-headings:font-bold
                      prose-h1:text-xl prose-h1:mt-4 prose-h1:mb-2
                      prose-h2:text-lg prose-h2:mt-3 prose-h2:mb-2
                      prose-h3:text-base prose-h3:mt-2 prose-h3:mb-1
                      prose-p:my-2 prose-p:leading-relaxed prose-p:text-sm
                      prose-a:text-violet-600 prose-a:no-underline hover:prose-a:underline
                      prose-pre:bg-zinc-100 prose-pre:dark:bg-zinc-900
                      prose-pre:p-4 prose-pre:rounded-lg prose-pre:overflow-x-auto
                      prose-blockquote:border-l-4 prose-blockquote:border-violet-300
                      prose-blockquote:dark:border-violet-700 prose-blockquote:pl-4
                      prose-blockquote:italic prose-blockquote:text-zinc-600
                      prose-blockquote:dark:text-zinc-400
                      prose-ul:my-2 prose-ol:my-2
                      prose-li:my-1 prose-li:text-sm
                      [&_code]:bg-zinc-200 [&_code]:dark:bg-zinc-700
                      [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
                      [&_code]:text-sm [&_code]:font-mono
                      [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200
                      [&_code]:before:content-[''] [&_code]:after:content-['']
                      [&_pre_code]:bg-transparent [&_pre_code]:p-0"
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={createMarkdownComponents(handleEditCode)}
                      >
                        {task.description}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div className="px-8 py-4 bg-zinc-50 dark:bg-zinc-800/30 border-t border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6 text-xs text-zinc-400 dark:text-zinc-500">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      作成:{" "}
                      {new Date(task.createdAt).toLocaleDateString("ja-JP")}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      更新:{" "}
                      {new Date(task.updatedAt).toLocaleDateString("ja-JP")}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* AIタスク分析トグル */}
                    <ToggleButton
                      label="AIタスク分析モード"
                      icon={BrainCircuit}
                      isEnabled={showTaskAnalysis}
                      onToggle={() => setShowTaskAnalysis(!showTaskAnalysis)}
                    />
                    {/* 開発者モードトグル */}
                    <ToggleButton
                      label="開発者モード"
                      icon={Bot}
                      isEnabled={devModeConfig?.isEnabled ?? false}
                      isLoading={devModeLoading}
                      onToggle={handleToggleDeveloperMode}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* AI アシスタントパネル（タスク分析 + プロンプト最適化 + 設定を統合） */}
            {showTaskAnalysis && (
              <div className="mb-6">
                <AIAnalysisPanel
                  taskId={taskId}
                  config={devModeConfig}
                  isAnalyzing={isAnalyzing}
                  analysisResult={analysisResult as any}
                  analysisError={analysisError}
                  analysisApprovalId={analysisApprovalId}
                  onAnalyze={handleAnalyze}
                  onApprove={handleApproveAnalysis}
                  onReject={handleRejectAnalysis}
                  onApproveSubtasks={approveSubtaskCreation}
                  isApproving={approvalLoading}
                  onOpenSettings={() => setShowDevModeConfig(true)}
                  onPromptGenerated={(prompt) => setOptimizedPrompt(prompt)}
                  onSubtasksCreated={async () => {
                    // タスクを再取得してサブタスクを更新
                    const res = await fetch(`${API_BASE}/tasks/${params.id}`);
                    if (res.ok) {
                      const data = await res.json();
                      setTask(data);
                    }
                  }}
                />
              </div>
            )}

            {/* Developer Mode Section - AI自動実装機能 */}
            {devModeConfig?.isEnabled && task.theme?.isDevelopment && (
              <div className="mb-6">
                <AgentExecutionPanel
                  taskId={taskId}
                  isExecuting={isExecuting}
                  executionStatus={executionStatus}
                  executionResult={executionResult}
                  error={executionResult?.error || null}
                  workingDirectory={task.theme?.workingDirectory || undefined}
                  defaultBranch={task.theme?.defaultBranch || "main"}
                  useTaskAnalysis={showTaskAnalysis && !!analysisResult}
                  optimizedPrompt={optimizedPrompt}
                  onExecute={executeAgent}
                  onReset={resetExecutionState}
                  onRestoreExecutionState={restoreExecutionState}
                  onStopExecution={setExecutionCancelled}
                />
              </div>
            )}

            {/* Subtasks Section (AI生成含む) */}
            {task.subtasks && task.subtasks.length > 0 && (
              <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden mb-6">
                <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <h2 className="text-lg font-bold">サブタスク</h2>
                    <span className="ml-1 px-2 py-0.5 text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-full">
                      {task.subtasks.length}
                    </span>
                  </div>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {task.subtasks.map((subtask) => (
                    <div
                      key={subtask.id}
                      className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() =>
                            updateStatus(
                              subtask.id,
                              subtask.status === "done" ? "todo" : "done",
                            )
                          }
                          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            subtask.status === "done"
                              ? "border-emerald-500 bg-emerald-500"
                              : "border-zinc-300 dark:border-zinc-600 hover:border-emerald-400"
                          }`}
                        >
                          {subtask.status === "done" && (
                            <svg
                              className="w-3 h-3 text-white"
                              fill="currentColor"
                              viewBox="0 0 12 12"
                            >
                              <path d="M10.28 2.28a.75.75 0 00-1.06-1.06L4.5 5.94 2.78 4.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l5.25-5.25z" />
                            </svg>
                          )}
                        </button>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-medium ${subtask.status === "done" ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-zinc-50"}`}
                            >
                              {subtask.title}
                            </span>
                            {subtask.agentGenerated && (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded">
                                <Bot className="w-3 h-3" />
                                AI
                              </span>
                            )}
                          </div>
                          {subtask.description && (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                              {subtask.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comments Section */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
              <div
                className="p-4 border-b border-zinc-100 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                onClick={() => setIsCommentsExpanded(!isCommentsExpanded)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
                    <MessageSquare className="w-5 h-5 text-blue-500" />
                    <h2 className="text-lg font-bold">コメント</h2>
                    {comments.length > 0 && (
                      <span className="ml-1 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-full">
                        {comments.length}
                      </span>
                    )}
                  </div>
                  {isCommentsExpanded ? (
                    <ChevronUp className="w-5 h-5 text-zinc-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-zinc-400" />
                  )}
                </div>
              </div>

              {isCommentsExpanded && (
                <>
                  {/* Add Comment */}
                  <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
                    <div className="flex gap-3">
                      <textarea
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        className="flex-1 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-3 text-sm border-none outline-none resize-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                        rows={2}
                        placeholder="コメントを追加..."
                      />
                      <button
                        onClick={handleAddComment}
                        disabled={!newComment.trim() || isAddingComment}
                        className="self-end px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Comments List */}
                  {comments.length > 0 && (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {comments.map((comment) => (
                        <div
                          key={comment.id}
                          className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                        >
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-xs text-zinc-400 dark:text-zinc-500">
                              {new Date(comment.createdAt).toLocaleString("ja-JP")}
                            </span>
                            <button
                              onClick={() => handleDeleteComment(comment.id)}
                              className="p-1 text-zinc-400 hover:text-red-500 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {comment.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {comments.length === 0 && (
                    <div className="p-8 text-center">
                      <MessageSquare className="w-10 h-10 mx-auto mb-3 text-zinc-200 dark:text-zinc-700" />
                      <p className="text-sm text-zinc-400 dark:text-zinc-500">
                        コメントはまだありません
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
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
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-4xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-5 flex items-center hover:border-gray-300 dark:hover:border-gray-700 justify-between">
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
                  fetch(`${API_BASE}/tasks/${params.id}`)
                    .then((res) => res.json())
                    .then((data) => setTask(data));
                  fetch(`${API_BASE}/tasks/${params.id}/time-entries`)
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
      />

      {/* Code Block Dialog */}
      {showCodeBlockDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-3xl max-h-[90vh] overflow-auto">
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
    </div>
  );
}
