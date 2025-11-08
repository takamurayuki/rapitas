"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Task = {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  labels?: string[];
  estimatedHours?: number | null;
  parentId?: number | null;
  subtasks?: Task[];
  createdAt: string;
  updatedAt: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

const statusColors = {
  todo: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  "in-progress":
    "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

const statusLabels = {
  todo: "未着手",
  "in-progress": "進行中",
  done: "完了",
};

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
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

    if (params.id) {
      fetchTask();
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
          return { ...prev, status: newStatus };
        }
        if (prev.subtasks) {
          return {
            ...prev,
            subtasks: prev.subtasks.map((st) =>
              st.id === taskId ? { ...st, status: newStatus } : st
            ),
          };
        }
        return prev;
      });
    } catch (err) {
      console.error(err);
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

  const completedSubtasks =
    task.subtasks?.filter((s) => s.status === "done") || [];
  const activeSubtasks =
    task.subtasks?.filter((s) => s.status !== "done") || [];
  const totalSubtasks = task.subtasks?.length || 0;
  const progressPercentage =
    totalSubtasks > 0
      ? Math.round((completedSubtasks.length / totalSubtasks) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-4xl mx-auto p-6">
        {/* ヘッダー */}
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
            タスク一覧に戻る
          </button>

          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                <button
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
                </button>
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
                <button
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
                </button>
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
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  説明
                </label>
                <textarea
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={6}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
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
                  <p className="text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                    {task.description}
                  </p>
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
              <div className="space-y-3">
                {activeSubtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-4"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h4 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-1">
                          {subtask.title}
                        </h4>
                        {subtask.description && (
                          <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                            {subtask.description}
                          </p>
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
              <div className="space-y-2">
                {completedSubtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3 opacity-60"
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
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="説明（任意）"
                        value={subtaskDescription}
                        onChange={(e) => setSubtaskDescription(e.target.value)}
                        rows={2}
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
      </div>
    </div>
  );
}