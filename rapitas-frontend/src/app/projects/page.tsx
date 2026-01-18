"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/types";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    color: "#3B82F6",
    icon: "📁",
  });

  const iconOptions = [
    "📁",
    "🎯",
    "🚀",
    "💼",
    "🏆",
    "📊",
    "🔧",
    "💡",
    "📝",
    "🌟",
    "🎨",
    "⚡",
  ];

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch("http://localhost:3001/projects");
      const data = await res.json();
      setProjects(data);
    } catch (error) {
      console.error("Failed to fetch projects:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingProject) {
        // 編集
        const res = await fetch(
          `http://localhost:3001/projects/${editingProject.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formData),
          }
        );
        if (res.ok) {
          await fetchProjects();
          handleCloseModal();
        }
      } else {
        // 新規作成
        const res = await fetch("http://localhost:3001/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (res.ok) {
          await fetchProjects();
          handleCloseModal();
        }
      }
    } catch (error) {
      console.error("Failed to save project:", error);
    }
  };

  const handleDelete = async (id: number) => {
    if (
      !confirm(
        "このプロジェクトを削除しますか?関連するタスクとマイルストーンも削除されます。"
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`http://localhost:3001/projects/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchProjects();
      }
    } catch (error) {
      console.error("Failed to delete project:", error);
    }
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      description: project.description || "",
      color: project.color,
      icon: project.icon || "📁",
    });
    setShowCreateModal(true);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setEditingProject(null);
    setFormData({
      name: "",
      description: "",
      color: "#3B82F6",
      icon: "📁",
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-gray-400">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">プロジェクト</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          + 新規プロジェクト
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((project) => (
          <div
            key={project.id}
            className="bg-gray-800 rounded-lg p-6 hover:bg-gray-750 transition-colors border-l-4"
            style={{ borderLeftColor: project.color }}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{project.icon || "📁"}</span>
                <h3 className="text-lg font-semibold">{project.name}</h3>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEdit(project)}
                  className="text-gray-400 hover:text-blue-400 text-sm"
                >
                  編集
                </button>
                <button
                  onClick={() => handleDelete(project.id)}
                  className="text-gray-400 hover:text-red-400 text-sm"
                >
                  削除
                </button>
              </div>
            </div>

            {project.description && (
              <p className="text-gray-400 text-sm mb-4 line-clamp-2">
                {project.description}
              </p>
            )}

            <div className="flex gap-4 text-sm text-gray-400">
              <div className="flex items-center gap-1">
                <span>📋</span>
                <span>{project._count?.tasks || 0} タスク</span>
              </div>
              <div className="flex items-center gap-1">
                <span>🎯</span>
                <span>{project._count?.milestones || 0} マイルストーン</span>
              </div>
            </div>

            <button
              onClick={() => router.push(`/projects/${project.id}`)}
              className="mt-4 w-full py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
            >
              詳細を表示
            </button>
          </div>
        ))}

        {projects.length === 0 && (
          <div className="col-span-full text-center text-gray-400 py-12">
            プロジェクトがありません。新規作成してください。
          </div>
        )}
      </div>

      {/* モーダル */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {editingProject ? "プロジェクトを編集" : "新規プロジェクト"}
            </h2>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    プロジェクト名
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
                  <label className="block text-sm font-medium mb-1">
                    カラー
                  </label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={formData.color}
                      onChange={(e) =>
                        setFormData({ ...formData, color: e.target.value })
                      }
                      className="h-10 w-20 rounded cursor-pointer"
                    />
                    <span className="text-sm text-gray-400">
                      {formData.color}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    アイコン
                  </label>
                  <div className="grid grid-cols-6 gap-2">
                    {iconOptions.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        onClick={() => setFormData({ ...formData, icon })}
                        className={`text-2xl p-2 rounded hover:bg-gray-700 transition-colors ${
                          formData.icon === icon
                            ? "bg-gray-700 ring-2 ring-blue-500"
                            : ""
                        }`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 mt-6">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  {editingProject ? "更新" : "作成"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
