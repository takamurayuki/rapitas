"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Project, Milestone, Task } from "@/types";
import { useToast } from "@/components/ui/toast/toast-container";
import { CheckCircle2, Circle, PlayCircle, Calendar, Clock } from "lucide-react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function ProjectDetailPage() {
  const { showToast } = useToast();
  const params = useParams();
  const router = useRouter();
  const projectId = Number(params.id);

  const [project, setProject] = useState<Project | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(
    null
  );
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    dueDate: "",
  });

  useEffect(() => {
    fetchProjectData();
  }, [projectId]);

  const fetchProjectData = async () => {
    try {
      const [projectRes, milestonesRes, tasksRes] = await Promise.all([
        fetch(`${API_BASE}/projects/${projectId}`),
        fetch(`${API_BASE}/milestones?projectId=${projectId}`),
        fetch(`${API_BASE}/tasks?projectId=${projectId}`),
      ]);
      const projectData = await projectRes.json();
      const milestonesData = await milestonesRes.json();
      const tasksData = await tasksRes.json();
      setProject(projectData);
      setMilestones(milestonesData);
      setTasks(Array.isArray(tasksData) ? tasksData : []);
    } catch (error) {
      console.error("Failed to fetch project data:", error);
      showToast("データの取得に失敗しました", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        projectId,
        dueDate: formData.dueDate
          ? new Date(formData.dueDate).toISOString()
          : undefined,
      };

      if (editingMilestone) {
        const res = await fetch(
          `${API_BASE}/milestones/${editingMilestone.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        if (res.ok) {
          await fetchProjectData();
          handleCloseMilestoneModal();
          showToast("マイルストーンを更新しました", "success");
        } else {
          showToast("マイルストーンの更新に失敗しました", "error");
        }
      } else {
        const res = await fetch(`${API_BASE}/milestones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          await fetchProjectData();
          handleCloseMilestoneModal();
          showToast("マイルストーンを作成しました", "success");
        } else {
          showToast("マイルストーンの作成に失敗しました", "error");
        }
      }
    } catch (error) {
      console.error("Failed to save milestone:", error);
      showToast("エラーが発生しました", "error");
    }
  };

  const handleDeleteMilestone = async (id: number) => {
    if (
      !confirm(
        "このマイルストーンを削除しますか?関連するタスクのマイルストーンがクリアされます。"
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/milestones/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchProjectData();
        showToast("マイルストーンを削除しました", "success");
      } else {
        showToast("マイルストーンの削除に失敗しました", "error");
      }
    } catch (error) {
      console.error("Failed to delete milestone:", error);
      showToast("エラーが発生しました", "error");
    }
  };

  const handleEditMilestone = (milestone: Milestone) => {
    setEditingMilestone(milestone);
    setFormData({
      name: milestone.name,
      description: milestone.description || "",
      dueDate: milestone.dueDate
        ? new Date(milestone.dueDate).toISOString().split("T")[0]
        : "",
    });
    setShowMilestoneModal(true);
  };

  const handleCloseMilestoneModal = () => {
    setShowMilestoneModal(false);
    setEditingMilestone(null);
    setFormData({
      name: "",
      description: "",
      dueDate: "",
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-gray-400">読み込み中...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8">
        <div className="text-gray-400">プロジェクトが見つかりません</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* プロジェクトヘッダー */}
      <div className="mb-8">
        <button
          onClick={() => router.push("/projects")}
          className="text-gray-400 hover:text-white mb-4 flex items-center gap-1"
        >
          ← プロジェクト一覧へ戻る
        </button>
        <div className="flex items-start gap-4">
          <span className="text-4xl">{project.icon || "📁"}</span>
          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-2">{project.name}</h1>
            {project.description && (
              <p className="text-gray-400">{project.description}</p>
            )}
            <div className="flex gap-4 mt-3 text-sm text-gray-400">
              <div className="flex items-center gap-1">
                <span>📋</span>
                <span>{project._count?.tasks || 0} タスク</span>
              </div>
              <div className="flex items-center gap-1">
                <span>🎯</span>
                <span>{project._count?.milestones || 0} マイルストーン</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* マイルストーン一覧 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">マイルストーン</h2>
          <button
            onClick={() => setShowMilestoneModal(true)}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            + 新規マイルストーン
          </button>
        </div>

        <div className="space-y-3">
          {milestones.map((milestone) => (
            <div
              key={milestone.id}
              className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-lg">{milestone.name}</h3>
                    {milestone.dueDate && (
                      <span className="text-sm text-gray-400">
                        期限:{" "}
                        {new Date(milestone.dueDate).toLocaleDateString(
                          "ja-JP"
                        )}
                      </span>
                    )}
                  </div>
                  {milestone.description && (
                    <p className="text-gray-400 text-sm mb-2">
                      {milestone.description}
                    </p>
                  )}
                  <div className="text-sm text-gray-400">
                    <span>📋 {milestone._count?.tasks || 0} タスク</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditMilestone(milestone)}
                    className="text-gray-400 hover:text-blue-400 text-sm"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => handleDeleteMilestone(milestone.id)}
                    className="text-gray-400 hover:text-red-400 text-sm"
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))}

          {milestones.length === 0 && (
            <div className="text-center text-gray-400 py-8">
              マイルストーンがありません。新規作成してください。
            </div>
          )}
        </div>
      </div>

      {/* タスク一覧 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">タスク一覧</h2>
          <button
            onClick={() => router.push(`/tasks/new?projectId=${projectId}`)}
            className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600"
          >
            + 新規タスク
          </button>
        </div>

        <div className="space-y-2">
          {tasks.map((task) => {
            const statusConfig = {
              todo: { icon: Circle, color: "text-zinc-400", bg: "bg-zinc-100 dark:bg-zinc-800" },
              "in-progress": { icon: PlayCircle, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-900/30" },
              done: { icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-900/30" },
            };
            const config = statusConfig[task.status as keyof typeof statusConfig] || statusConfig.todo;
            const StatusIcon = config.icon;

            return (
              <div
                key={task.id}
                onClick={() => router.push(`/tasks/${task.id}`)}
                className={`${config.bg} rounded-lg p-4 hover:opacity-80 transition-all cursor-pointer border border-zinc-200 dark:border-zinc-700`}
              >
                <div className="flex items-center gap-3">
                  <StatusIcon className={`w-5 h-5 ${config.color}`} />
                  <div className="flex-1 min-w-0">
                    <h3 className={`font-medium truncate ${task.status === "done" ? "line-through text-zinc-400" : "text-zinc-900 dark:text-zinc-100"}`}>
                      {task.title}
                    </h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {task.dueDate && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(task.dueDate).toLocaleDateString("ja-JP")}
                        </span>
                      )}
                      {task.estimatedHours && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {task.estimatedHours}h
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {tasks.length === 0 && (
            <div className="text-center text-gray-400 py-8">
              タスクがありません。新規作成してください。
            </div>
          )}
        </div>
      </div>

      {/* マイルストーンモーダル */}
      {showMilestoneModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {editingMilestone ? "マイルストーンを編集" : "新規マイルストーン"}
            </h2>
            <form onSubmit={handleSubmitMilestone}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    マイルストーン名
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">説明</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 h-24"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">期限</label>
                  <input
                    type="date"
                    value={formData.dueDate}
                    onChange={(e) =>
                      setFormData({ ...formData, dueDate: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-6">
                <button
                  type="button"
                  onClick={handleCloseMilestoneModal}
                  className="flex-1 px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  {editingMilestone ? "更新" : "作成"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
