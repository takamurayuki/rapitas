"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

type SubtaskInput = {
  id: string;
  title: string;
  description: string;
  labels: string;
  estimatedHours: string;
};

export default function NewTaskPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [status, setStatus] = useState("todo");
  const [subtasks, setSubtasks] = useState<SubtaskInput[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // サブタスク入力フォーム用の状態
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskDescription, setSubtaskDescription] = useState("");
  const [subtaskLabels, setSubtaskLabels] = useState("");
  const [subtaskEstimatedHours, setSubtaskEstimatedHours] = useState("");
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [expandedSubtasks, setExpandedSubtasks] = useState<Set<string>>(
    new Set()
  );

  const addSubtask = () => {
    if (!subtaskTitle.trim()) return;

    const newSubtask: SubtaskInput = {
      id: Date.now().toString(),
      title: subtaskTitle,
      description: subtaskDescription,
      labels: subtaskLabels,
      estimatedHours: subtaskEstimatedHours,
    };

    setSubtasks([...subtasks, newSubtask]);

    // フォームをリセット
    setSubtaskTitle("");
    setSubtaskDescription("");
    setSubtaskLabels("");
    setSubtaskEstimatedHours("");
    setIsAddingSubtask(false);
  };

  const removeSubtask = (id: string) => {
    setSubtasks(subtasks.filter((st) => st.id !== id));
    // 削除したサブタスクが展開されていた場合、展開状態も削除
    const newExpanded = new Set(expandedSubtasks);
    newExpanded.delete(id);
    setExpandedSubtasks(newExpanded);
  };

  const updateSubtask = (
    id: string,
    field: keyof SubtaskInput,
    value: string
  ) => {
    setSubtasks(
      subtasks.map((st) => (st.id === id ? { ...st, [field]: value } : st))
    );
  };

  const toggleSubtaskExpanded = (id: string) => {
    const newExpanded = new Set(expandedSubtasks);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedSubtasks(newExpanded);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;

    setIsSubmitting(true);

    try {
      const labelArray = labels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);

      // メインタスクを作成
      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || undefined,
          status,
          labels: labelArray.length > 0 ? labelArray : undefined,
          estimatedHours: estimatedHours
            ? parseFloat(estimatedHours)
            : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error("タスクの作成に失敗しました");
      }

      const createdTask = await res.json();

      // サブタスクを作成
      if (subtasks.length > 0) {
        const subtaskPromises = subtasks
          .filter((st) => st.title.trim())
          .map((st) => {
            const stLabelArray = st.labels
              .split(",")
              .map((l) => l.trim())
              .filter(Boolean);

            return fetch(`${API_BASE}/tasks`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: st.title,
                description: st.description || undefined,
                status: "todo",
                labels: stLabelArray.length > 0 ? stLabelArray : undefined,
                estimatedHours: st.estimatedHours
                  ? parseFloat(st.estimatedHours)
                  : undefined,
                parentId: createdTask.id,
              }),
            });
          });

        await Promise.all(subtaskPromises);
      }

      router.push("/");
    } catch (err) {
      console.error(err);
      alert("タスクの作成に失敗しました");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-8">
          新しいタスクを作成
        </h1>

        {/* フォーム */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-8">
            {/* タイトル */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                タイトル <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="タスクのタイトルを入力"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                autoFocus
              />
            </div>

            {/* 説明 */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                説明
              </label>
              <textarea
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="タスクの詳細な説明を入力（任意）"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
              />
            </div>

            {/* ステータス */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                ステータス
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="todo">未着手</option>
                <option value="in-progress">進行中</option>
                <option value="done">完了</option>
              </select>
            </div>

            {/* ラベルと見積もり時間 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  ラベル
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例: バグ修正, 機能追加"
                  value={labels}
                  onChange={(e) => setLabels(e.target.value)}
                />
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  カンマ区切りで複数指定できます
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  見積もり時間
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例: 2.5"
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(e.target.value)}
                />
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  時間単位で入力してください
                </p>
              </div>
            </div>
          </div>

          {/* サブタスクセクション */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-8">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    サブタスク
                    {subtasks.length > 0 && (
                      <span className="ml-2 text-sm font-normal text-zinc-500">
                        ({subtasks.length}件)
                      </span>
                    )}
                  </h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                    必要に応じてサブタスクを追加できます（任意）
                  </p>
                </div>
              </div>
            </div>

            {/* 追加済みサブタスク一覧 */}
            {subtasks.length > 0 && (
              <div className="mb-4 space-y-2">
                {subtasks.map((subtask, index) => {
                  const isExpanded = expandedSubtasks.has(subtask.id);

                  return (
                    <div
                      key={subtask.id}
                      className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800"
                    >
                      {/* コンパクト表示 */}
                      <div className="flex items-center justify-between p-3">
                        <button
                          type="button"
                          onClick={() => toggleSubtaskExpanded(subtask.id)}
                          className="flex items-center gap-2 flex-1 text-left"
                        >
                          <svg
                            className={`w-4 h-4 transition-transform text-zinc-500 ${
                              isExpanded ? "rotate-90" : ""
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                            {subtask.title || `サブタスク ${index + 1}`}
                          </span>
                          {subtask.estimatedHours && (
                            <span className="text-xs text-zinc-500">
                              ({subtask.estimatedHours}h)
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSubtask(subtask.id)}
                          className="p-1 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
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
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>

                      {/* 展開時の詳細表示 */}
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-3 border-t border-zinc-200 dark:border-zinc-700 pt-3">
                          <div>
                            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                              タイトル
                            </label>
                            <input
                              type="text"
                              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="サブタスクタイトル"
                              value={subtask.title}
                              onChange={(e) =>
                                updateSubtask(
                                  subtask.id,
                                  "title",
                                  e.target.value
                                )
                              }
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                              説明
                            </label>
                            <textarea
                              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="説明（任意）"
                              value={subtask.description}
                              onChange={(e) =>
                                updateSubtask(
                                  subtask.id,
                                  "description",
                                  e.target.value
                                )
                              }
                              rows={2}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                ラベル
                              </label>
                              <input
                                type="text"
                                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="カンマ区切り"
                                value={subtask.labels}
                                onChange={(e) =>
                                  updateSubtask(
                                    subtask.id,
                                    "labels",
                                    e.target.value
                                  )
                                }
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                見積もり時間
                              </label>
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="時間"
                                value={subtask.estimatedHours}
                                onChange={(e) =>
                                  updateSubtask(
                                    subtask.id,
                                    "estimatedHours",
                                    e.target.value
                                  )
                                }
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* サブタスク追加フォーム */}
            {isAddingSubtask ? (
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-white dark:bg-zinc-900">
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
                      onChange={(e) => setSubtaskEstimatedHours(e.target.value)}
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

          {/* アクションボタン */}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="px-6 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
              disabled={isSubmitting}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="px-6 py-3 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isSubmitting}
            >
              {isSubmitting ? "作成中..." : "タスクを作成"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
