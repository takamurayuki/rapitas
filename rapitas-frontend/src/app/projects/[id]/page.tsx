"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Project, Milestone } from "@/types";

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = Number(params.id);

  const [project, setProject] = useState<Project | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
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
      const [projectRes, milestonesRes] = await Promise.all([
        fetch(`http://localhost:3001/projects/${projectId}`),
        fetch(`http://localhost:3001/milestones?projectId=${projectId}`),
      ]);
      const projectData = await projectRes.json();
      const milestonesData = await milestonesRes.json();
      setProject(projectData);
      setMilestones(milestonesData);
    } catch (error) {
      console.error("Failed to fetch project data:", error);
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
          `http://localhost:3001/milestones/${editingMilestone.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        if (res.ok) {
          await fetchProjectData();
          handleCloseMilestoneModal();
        }
      } else {
        const res = await fetch("http://localhost:3001/milestones", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          await fetchProjectData();
          handleCloseMilestoneModal();
        }
      }
    } catch (error) {
      console.error("Failed to save milestone:", error);
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
      const res = await fetch(`http://localhost:3001/milestones/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchProjectData();
      }
    } catch (error) {
      console.error("Failed to delete milestone:", error);
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
