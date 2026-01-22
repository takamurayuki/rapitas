"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { Task, TimeEntry, Comment } from "@/types";
import { Timer, Coffee, Pause, Square, Flame, Hourglass } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createMarkdownComponents } from "@/feature/tasks/components/markdown-components";
import PomodoroTimer from "@/feature/tasks/components/pomodoro-timer";
import Button from "@/components/ui/button";
import {
  usePomodoro,
  formatTime,
  getRemainingTime,
} from "@/feature/tasks/pomodoro/PomodoroProvider";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

const statusColors = {
  todo: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  "in-progress":
    "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

const PROGRAMMING_LANGUAGES = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "csharp", label: "C#" },
  { value: "cpp", label: "C++" },
  { value: "c", label: "C" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "sql", label: "SQL" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "scss", label: "SCSS" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "markdown", label: "Markdown" },
  { value: "bash", label: "Bash" },
  { value: "shell", label: "Shell" },
  { value: "powershell", label: "PowerShell" },
  { value: "plaintext", label: "Plain Text" },
];

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hideHeader = searchParams.get("hideHeader") === "true";

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // 編集フォーム用の状態
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editLabels, setEditLabels] = useState("");
  const [editEstimatedHours, setEditEstimatedHours] = useState("");

  // サブタスク追加用の状態
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskDescription, setSubtaskDescription] = useState("");
  const [subtaskLabels, setSubtaskLabels] = useState("");
  const [subtaskEstimatedHours, setSubtaskEstimatedHours] = useState("");

  // コードブロック追加用の状態
  const [showCodeBlockDialog, setShowCodeBlockDialog] = useState(false);
  const [codeBlockLanguage, setCodeBlockLanguage] = useState("javascript");
  const [codeBlockContent, setCodeBlockContent] = useState("");
  const [isEditingCode, setIsEditingCode] = useState(false);
  const [originalCodeBlock, setOriginalCodeBlock] = useState<{
    language: string;
    code: string;
  } | null>(null);

  // ファイル・画像アップロード用の状態
  const [isDragging, setIsDragging] = useState(false);

  // 時間トラッキング用の状態
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);

  // コメント用の状態
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isAddingComment, setIsAddingComment] = useState(false);

  // ポモドーロモーダル用の状態
  const [showPomodoroModal, setShowPomodoroModal] = useState(false);
  const { state: pomodoroState } = usePomodoro();

  // このタスクのタイマーかどうか
  const isThisTaskTimer = pomodoroState.taskId === task?.id;

  // サブタスクの計算
  const totalSubtasks = task?.subtasks?.length || 0;
  const completedSubtasks =
    task?.subtasks?.filter((st) => st.status === "done") || [];
  const activeSubtasks =
    task?.subtasks?.filter((st) => st.status !== "done") || [];
  const progressPercentage =
    totalSubtasks > 0
      ? Math.round((completedSubtasks.length / totalSubtasks) * 100)
      : 0;

  useEffect(() => {
    const fetchTask = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/tasks/${params.id}`);
        if (!res.ok) {
          throw new Error("タスクの取得に失敗しました");
        }
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
        if (res.ok) {
          const data = await res.json();
          setTimeEntries(data);
        }
      } catch (err) {
        console.error("Failed to fetch time entries:", err);
      }
    };

    const fetchComments = async () => {
      try {
        const res = await fetch(`${API_BASE}/tasks/${params.id}/comments`);
        if (res.ok) {
          const data = await res.json();
          setComments(data);
        }
      } catch (err) {
        console.error("Failed to fetch comments:", err);
      }
    };

    if (params.id) {
      fetchTask();
      fetchTimeEntries();
      fetchComments();
    }
  }, [params.id]);

  const updateStatus = async (taskId: number, newStatus: string) => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("ステータス更新に失敗しました");
      const updated = await res.json();

      setTask((prev) => {
        if (!prev) return prev;
        if (prev.id === taskId) {
          return { ...prev, status: newStatus as Task["status"] };
        }
        if (prev.subtasks) {
          return {
            ...prev,
            subtasks: prev.subtasks.map((st) =>
              st.id === taskId
                ? { ...st, status: newStatus as Task["status"] }
                : st,
            ),
          };
        }
        return prev;
      });
    } catch (err) {
      console.error(err);
    }
  };

  const insertCodeBlock = () => {
    if (isEditingCode && originalCodeBlock) {
      // 編集モード: 既存のコードブロックを置換
      const oldBlock = `\`\`\`${originalCodeBlock.language}\n${originalCodeBlock.code}\n\`\`\``;
      const newBlock = `\`\`\`${codeBlockLanguage}\n${codeBlockContent}\n\`\`\``;
      setEditDescription(editDescription.replace(oldBlock, newBlock));
    } else {
      // 新規追加モード
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

  const handleFileDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    for (const file of files) {
      // 画像ファイルの場合
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target?.result as string;
          const imageMarkdown = `\n![${file.name}](${base64})\n`;
          setEditDescription(editDescription + imageMarkdown);
        };
        reader.readAsDataURL(file);
      } else {
        // その他のファイル（テキストファイルなど）
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          const fileMarkdown = `\n**📎 ${file.name}**\n\`\`\`\n${content}\n\`\`\`\n`;
          setEditDescription(editDescription + fileMarkdown);
        };
        reader.readAsText(file);
      }
    }
  };

  // コメント関数
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
    setEditEstimatedHours(task.estimatedHours?.toString() || "");
    setIsEditing(true);
  };

  const startTimer = () => {};

  const cancelEditing = () => {
    setIsEditing(false);
  };

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

      router.push("/");
    } catch (err) {
      console.error(err);
      alert("タスクの削除に失敗しました");
    }
  };

  const deleteSubtask = async (subtaskId: number) => {
    if (!confirm("このサブタスクを削除しますか?")) return;

    try {
      const res = await fetch(`${API_BASE}/tasks/${subtaskId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("削除に失敗しました");

      setTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: prev.subtasks?.filter((st) => st.id !== subtaskId),
        };
      });
    } catch (err) {
      console.error(err);
      alert("サブタスクの削除に失敗しました");
    }
  };

  const addSubtask = async () => {
    if (!task || !subtaskTitle.trim()) return;

    try {
      const labelArray = subtaskLabels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);

      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: subtaskTitle,
          description: subtaskDescription || undefined,
          status: "todo",
          labels: labelArray.length > 0 ? labelArray : undefined,
          estimatedHours: subtaskEstimatedHours
            ? parseFloat(subtaskEstimatedHours)
            : undefined,
          parentId: task.id,
        }),
      });

      if (!res.ok) throw new Error("サブタスクの作成に失敗しました");
      const newSubtask = await res.json();

      setTask((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subtasks: [...(prev.subtasks || []), newSubtask],
        };
      });

      // フォームをリセット
      setSubtaskTitle("");
      setSubtaskDescription("");
      setSubtaskLabels("");
      setSubtaskEstimatedHours("");
      setIsAddingSubtask(false);
    } catch (err) {
      console.error(err);
      alert("サブタスクの追加に失敗しました");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-600 dark:text-zinc-400">読み込み中...</div>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">
            {error || "タスクが見つかりません"}
          </p>
          <button
            onClick={() => router.push("/")}
            className="text-blue-600 hover:underline"
          >
            ホームに戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-4xl mx-auto p-6">
        {/* ページ内ヘッダー（戻るボタン・編集ボタン） */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setShowPomodoroModal(true)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 border rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors ${
                isThisTaskTimer && pomodoroState.isTimerRunning
                  ? pomodoroState.isBreakTime
                    ? "bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700"
                    : pomodoroState.isPaused
                      ? "bg-orange-50 dark:bg-orange-950 border-orange-300 dark:border-orange-700"
                      : "bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700"
                  : "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
              }`}
              title={
                isThisTaskTimer && pomodoroState.isTimerRunning
                  ? pomodoroState.isBreakTime
                    ? "休憩中"
                    : pomodoroState.isPaused
                      ? "一時停止中"
                      : "作業中"
                  : "タイマー停止中"
              }
            >
              {isThisTaskTimer && pomodoroState.isTimerRunning ? (
                pomodoroState.isBreakTime ? (
                  <Coffee className="w-4 h-4 text-green-500" />
                ) : pomodoroState.isPaused ? (
                  <Pause className="w-4 h-4 text-orange-500" />
                ) : (
                  <Hourglass className="w-4 h-4 text-blue-500 animate-pulse" />
                )
              ) : (
                <Timer className="w-4 h-4 text-zinc-400" />
              )}
              時間管理
              {isThisTaskTimer && pomodoroState.isTimerRunning && (
                <span className="text-xs font-mono tabular-nums">
                  {formatTime(getRemainingTime(pomodoroState))}
                </span>
              )}
            </button>
            {!isEditing ? (
              <>
                <Button
                  onClick={startEditing}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
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
                  onClick={deleteTask}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
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
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  削除
                </button>
              </>
            ) : (
              <>
                <Button
                  onClick={saveTask}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
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
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  保存
                </Button>
                <button
                  onClick={cancelEditing}
                  className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  キャンセル
                </button>
              </>
            )}
          </div>
        </div>

        {/* メインタスク */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-8 mb-6">
          {isEditing ? (
            /* 編集モード */
            <div className="space-y-6">
              {/* タイトル */}
              <div>
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  タイトル <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-lg font-bold shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                />
              </div>

              {/* 説明 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    説明
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowCodeBlockDialog(true)}
                    className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md transition-colors"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                      />
                    </svg>
                    コードブロック追加
                  </button>
                </div>
                <textarea
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  rows={14}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleFileDrop}
                  placeholder="マークダウン形式で記述できます&#10;&#10;# 見出し1&#10;## 見出し2&#10;&#10;**太字** *斜体*&#10;&#10;- [ ] チェックボックス&#10;- [x] 完了済み&#10;&#10;`インラインコード` や > 引用&#10;&#10;コードブロックは上の「コードブロック追加」ボタンから挿入できます&#10;&#10;ファイルや画像はここにドラッグ&ドロップできます"
                />
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
                  <span className="font-semibold">インラインコード:</span>{" "}
                  `backtick` で囲むと灰色背景で表示
                  <br />
                  <span className="font-semibold">コードブロック:</span>{" "}
                  「コードブロック追加」ボタンから言語を選択して挿入
                  <br />
                  <span className="font-semibold">ファイル・画像:</span>{" "}
                  ドラッグ&ドロップで添付可能
                </p>
              </div>

              {/* ステータス */}
              <div>
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  ステータス
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="todo">未着手</option>
                  <option value="in-progress">進行中</option>
                  <option value="done">完了</option>
                </select>
              </div>

              {/* ラベルと見積もり時間 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                    ラベル
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="カンマ区切りで入力"
                    value={editLabels}
                    onChange={(e) => setEditLabels(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                    見積もり時間
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="時間"
                    value={editEstimatedHours}
                    onChange={(e) => setEditEstimatedHours(e.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : (
            /* 表示モード */
            <>
              <div className="flex items-start justify-between mb-4">
                <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
                  {task.title}
                </h1>
                <select
                  value={task.status}
                  onChange={(e) => updateStatus(task.id, e.target.value)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    statusColors[task.status as keyof typeof statusColors]
                  } border-0 focus:outline-none focus:ring-2 focus:ring-blue-500`}
                >
                  <option value="todo">未着手</option>
                  <option value="in-progress">進行中</option>
                  <option value="done">完了</option>
                </select>
              </div>

              {task.description && (
                <div className="mb-6">
                  <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                    説明
                  </h2>
                  <div
                    className="prose prose-sm prose-zinc dark:prose-invert max-w-none 
                    prose-headings:font-bold 
                    prose-h1:text-2xl prose-h1:mt-4 prose-h1:mb-2
                    prose-h2:text-xl prose-h2:mt-3 prose-h2:mb-2
                    prose-h3:text-lg prose-h3:mt-2 prose-h3:mb-1
                    prose-p:my-2 prose-p:leading-relaxed
                    prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                    prose-pre:bg-zinc-100 prose-pre:dark:bg-zinc-800 
                    prose-pre:p-4 prose-pre:rounded-lg prose-pre:overflow-x-auto
                    prose-blockquote:border-l-4 prose-blockquote:border-zinc-300 
                    prose-blockquote:dark:border-zinc-700 prose-blockquote:pl-4 
                    prose-blockquote:italic prose-blockquote:text-zinc-600 
                    prose-blockquote:dark:text-zinc-400
                    prose-ul:my-2 prose-ol:my-2
                    prose-li:my-1
                    prose-table:border-collapse prose-table:w-full
                    prose-th:border prose-th:border-zinc-300 prose-th:dark:border-zinc-700 
                    prose-th:bg-zinc-100 prose-th:dark:bg-zinc-800 prose-th:px-3 prose-th:py-2
                    prose-td:border prose-td:border-zinc-300 prose-td:dark:border-zinc-700 
                    prose-td:px-3 prose-td:py-2
                    prose-img:rounded-lg prose-img:shadow-md
                    prose-hr:border-zinc-300 prose-hr:dark:border-zinc-700
                    [&_code]:bg-zinc-100 [&_code]:dark:bg-zinc-800 
                    [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded 
                    [&_code]:text-sm [&_code]:font-mono
                    [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200
                    [&_code]:before:content-[''] [&_code]:after:content-['']
                    [&_pre_code]:bg-transparent [&_pre_code]:p-0"
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={createMarkdownComponents(
                        isEditing ? handleEditCode : undefined,
                      )}
                    >
                      {task.description}
                    </ReactMarkdown>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 mb-6">
                {task.labels && task.labels.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                      ラベル
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {task.labels.map((label, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 text-sm"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {task.estimatedHours && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                      見積もり時間
                    </h3>
                    <span className="px-3 py-1 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 text-sm inline-block">
                      ⏱ {task.estimatedHours}時間
                    </span>
                  </div>
                )}
              </div>

              <div className="text-sm text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-zinc-700 pt-4">
                <p>
                  作成日時: {new Date(task.createdAt).toLocaleString("ja-JP")}
                </p>
                <p>
                  更新日時: {new Date(task.updatedAt).toLocaleString("ja-JP")}
                </p>
              </div>
            </>
          )}
        </div>

        {/* サブタスクセクション - 編集モード時は非表示 */}
        {isEditing && (
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-8">
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                  サブタスク
                  {totalSubtasks > 0 && (
                    <span className="ml-3 text-base font-normal text-zinc-500">
                      {completedSubtasks.length}/{totalSubtasks}件完了
                    </span>
                  )}
                </h2>
              </div>

              {/* 進行状況バー */}
              {totalSubtasks > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                    <span>進捗状況</span>
                    <span className="font-medium">{progressPercentage}%</span>
                  </div>
                  <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 transition-all duration-300"
                      style={{ width: `${progressPercentage}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* アクティブなサブタスク */}
            {activeSubtasks.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
                  進行中・未着手
                </h3>
                <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                  {activeSubtasks.map((subtask) => (
                    <div
                      key={subtask.id}
                      className="border-b border-zinc-200 dark:border-zinc-700 last:border-b-0 p-3 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h4 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-1">
                            {subtask.title}
                          </h4>
                          {subtask.description && (
                            <div
                              className="prose prose-sm prose-zinc dark:prose-invert max-w-none mt-2
                            prose-headings:font-bold prose-headings:text-sm
                            prose-p:my-1 prose-p:text-sm prose-p:leading-relaxed
                            prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-li:text-sm
                            prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                            [&_code]:bg-zinc-200 [&_code]:dark:bg-zinc-700 
                            [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs
                            [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200
                            [&_code]:font-mono
                            [&_code]:before:content-[''] [&_code]:after:content-['']
                            [&_pre_code]:bg-transparent [&_pre_code]:p-0"
                            >
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={createMarkdownComponents()}
                              >
                                {subtask.description}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 ml-4 shrink-0">
                          <select
                            value={subtask.status}
                            onChange={(e) =>
                              updateStatus(subtask.id, e.target.value)
                            }
                            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                              statusColors[
                                subtask.status as keyof typeof statusColors
                              ]
                            } border-0 focus:outline-none focus:ring-2 focus:ring-blue-500`}
                          >
                            <option value="todo">未着手</option>
                            <option value="in-progress">進行中</option>
                            <option value="done">完了</option>
                          </select>
                          <button
                            onClick={() => deleteSubtask(subtask.id)}
                            className="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 transition-colors"
                            title="削除"
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
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {subtask.labels && subtask.labels.length > 0 && (
                          <div className="flex gap-1">
                            {subtask.labels.map((label, idx) => (
                              <span
                                key={idx}
                                className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                        {subtask.estimatedHours && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                            ⏱ {subtask.estimatedHours}h
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 完了したサブタスク */}
            {completedSubtasks.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-green-600 dark:text-green-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  完了 ({completedSubtasks.length}件)
                </h3>
                <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                  {completedSubtasks.map((subtask) => (
                    <div
                      key={subtask.id}
                      className="border-b border-zinc-200 dark:border-zinc-700 last:border-b-0 p-3 bg-white dark:bg-zinc-900 opacity-60"
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="text-base font-medium text-zinc-900 dark:text-zinc-50 line-through flex-1">
                          {subtask.title}
                        </h4>
                        <div className="flex items-center gap-2 ml-4">
                          <span
                            className={`rounded-md px-3 py-1 text-xs font-medium ${statusColors.done}`}
                          >
                            完了
                          </span>
                          <button
                            onClick={() => deleteSubtask(subtask.id)}
                            className="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 transition-colors"
                            title="削除"
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
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* サブタスク追加フォーム */}
            <div className={totalSubtasks > 0 ? "mt-6" : ""}>
              {isAddingSubtask ? (
                <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-white dark:bg-zinc-900 mb-4">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-3">
                    新しいサブタスク
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <input
                        type="text"
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="サブタスクタイトル *"
                        value={subtaskTitle}
                        onChange={(e) => setSubtaskTitle(e.target.value)}
                        autoFocus
                      />
                    </div>

                    <div>
                      <textarea
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                        placeholder="説明（マークダウン対応）&#10;- [ ] チェックリスト&#10;`コード` **太字**"
                        value={subtaskDescription}
                        onChange={(e) => setSubtaskDescription(e.target.value)}
                        rows={3}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="ラベル（カンマ区切り）"
                        value={subtaskLabels}
                        onChange={(e) => setSubtaskLabels(e.target.value)}
                      />
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="見積もり時間（h）"
                        value={subtaskEstimatedHours}
                        onChange={(e) =>
                          setSubtaskEstimatedHours(e.target.value)
                        }
                      />
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={addSubtask}
                        className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                        disabled={!subtaskTitle.trim()}
                      >
                        追加
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingSubtask(false);
                          setSubtaskTitle("");
                          setSubtaskDescription("");
                          setSubtaskLabels("");
                          setSubtaskEstimatedHours("");
                        }}
                        className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAddingSubtask(true)}
                  className="w-full rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  + サブタスクを追加
                </button>
              )}
            </div>
          </div>
        )}

        {/* コメントセクション */}
        {!isEditing && (
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-6 mt-6">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4 flex items-center gap-2">
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
                  d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                />
              </svg>
              コメント ({comments.length})
            </h2>

            {/* コメント追加フォーム */}
            <div className="mb-4">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                rows={3}
                placeholder="コメントを追加... (マークダウン対応)"
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={handleAddComment}
                  disabled={!newComment.trim() || isAddingComment}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAddingComment ? "追加中..." : "コメント追加"}
                </button>
              </div>
            </div>

            {/* コメント一覧 */}
            {comments.length > 0 && (
              <div className="space-y-4">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-4"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs text-zinc-500">
                        {new Date(comment.createdAt).toLocaleString("ja-JP")}
                      </span>
                      <button
                        onClick={() => handleDeleteComment(comment.id)}
                        className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs"
                      >
                        削除
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
          </div>
        )}
      </div>

      {/* ポモドーロモーダル */}
      {!isEditing && task && (
        <div
          className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 transition-opacity ${showPomodoroModal ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          onClick={() => setShowPomodoroModal(false)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-800 w-full max-w-4xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                <>
                  <Timer className="w-5 h-5 text-zinc-400" /> 時間管理
                </>
              </h2>
              <button
                onClick={() => setShowPomodoroModal(false)}
                className="p-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                title="閉じる"
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
                  // タスクと時間エントリーを再取得
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

      {/* コードブロック追加ダイアログ */}
      {showCodeBlockDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-800 w-full max-w-3xl max-h-[90vh] overflow-auto">
            <div className="p-6">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mb-4">
                {isEditingCode
                  ? "コードブロックを編集"
                  : "コードブロックを追加"}
              </h3>

              {/* 言語選択 */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  プログラミング言語
                </label>
                <select
                  value={codeBlockLanguage}
                  onChange={(e) => setCodeBlockLanguage(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PROGRAMMING_LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* コード入力 */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  コード
                </label>
                <textarea
                  value={codeBlockContent}
                  onChange={(e) => setCodeBlockContent(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  rows={12}
                  placeholder="ここにコードを入力してください..."
                />
              </div>

              {/* プレビュー */}
              {codeBlockContent && (
                <div className="mb-4">
                  <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                    プレビュー
                  </label>
                  <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={createMarkdownComponents()}
                    >
                      {`\`\`\`${codeBlockLanguage}\n${codeBlockContent}\n\`\`\``}
                    </ReactMarkdown>
                  </div>
                </div>
              )}

              {/* ボタン */}
              <div className="flex gap-3">
                <button
                  onClick={insertCodeBlock}
                  disabled={!codeBlockContent.trim()}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-zinc-400 disabled:cursor-not-allowed"
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
                  className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
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
