"use client";
import { useEffect, useState } from "react";
import type { ExamGoal } from "@/types";
import {
  Plus,
  Edit2,
  Trash2,
  Calendar,
  Target,
  CheckCircle2,
  Clock,
  Trophy,
} from "lucide-react";
import { getIconComponent, ICON_DATA, searchIcons } from "@/components/category/icon-data";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

const PRESET_COLORS = [
  "#10B981", // emerald
  "#3B82F6", // blue
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#F59E0B", // amber
  "#EF4444", // red
  "#06B6D4", // cyan
  "#84CC16", // lime
];

export default function ExamGoalsPage() {
  const [examGoals, setExamGoals] = useState<ExamGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<ExamGoal | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    examDate: "",
    targetScore: "",
    color: "#10B981",
    icon: "",
  });
  const [iconSearch, setIconSearch] = useState("");
  const [showIconPicker, setShowIconPicker] = useState(false);

  useEffect(() => {
    fetchExamGoals();
  }, []);

  const fetchExamGoals = async () => {
    try {
      const res = await fetch(`${API_BASE}/exam-goals`);
      if (res.ok) {
        const data = await res.json();
        setExamGoals(data);
      }
    } catch (e) {
      console.error("Failed to fetch exam goals:", e);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingGoal(null);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 30);
    setFormData({
      name: "",
      description: "",
      examDate: tomorrow.toISOString().split("T")[0],
      targetScore: "",
      color: "#10B981",
      icon: "",
    });
    setIsModalOpen(true);
  };

  const openEditModal = (goal: ExamGoal) => {
    setEditingGoal(goal);
    setFormData({
      name: goal.name,
      description: goal.description || "",
      examDate: goal.examDate.split("T")[0],
      targetScore: goal.targetScore || "",
      color: goal.color,
      icon: goal.icon || "",
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.examDate) return;

    try {
      const url = editingGoal
        ? `${API_BASE}/exam-goals/${editingGoal.id}`
        : `${API_BASE}/exam-goals`;
      const method = editingGoal ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          examDate: formData.examDate,
          targetScore: formData.targetScore.trim() || null,
          color: formData.color,
          icon: formData.icon || null,
        }),
      });

      if (res.ok) {
        fetchExamGoals();
        setIsModalOpen(false);
      }
    } catch (e) {
      console.error("Failed to save exam goal:", e);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("この試験目標を削除しますか？")) return;
    try {
      const res = await fetch(`${API_BASE}/exam-goals/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchExamGoals();
      }
    } catch (e) {
      console.error("Failed to delete exam goal:", e);
    }
  };

  const handleComplete = async (goal: ExamGoal) => {
    const actualScore = prompt("実際のスコア/結果を入力してください（任意）:");
    try {
      const res = await fetch(`${API_BASE}/exam-goals/${goal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isCompleted: true,
          actualScore: actualScore || null,
        }),
      });
      if (res.ok) {
        fetchExamGoals();
      }
    } catch (e) {
      console.error("Failed to complete exam goal:", e);
    }
  };

  const getDaysRemaining = (examDate: string) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const exam = new Date(examDate);
    exam.setHours(0, 0, 0, 0);
    const diff = Math.ceil((exam.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  const renderIcon = (iconName: string | null | undefined, size = 20) => {
    const IconComponent = getIconComponent(iconName || "");
    if (!IconComponent) {
      return <Target size={size} />;
    }
    return <IconComponent size={size} />;
  };

  const filteredIcons = iconSearch ? searchIcons(iconSearch) : Object.keys(ICON_DATA).slice(0, 30);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-40 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const upcomingGoals = examGoals.filter((g) => !g.isCompleted);
  const completedGoals = examGoals.filter((g) => g.isCompleted);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            試験目標
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            試験や資格の目標を管理してカウントダウンを表示
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span>新規作成</span>
        </button>
      </div>

      {/* 直近の試験目標 */}
      {upcomingGoals.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            直近の試験目標
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {upcomingGoals.map((goal) => {
              const daysRemaining = getDaysRemaining(goal.examDate);
              const isUrgent = daysRemaining <= 7;
              const isNear = daysRemaining <= 30;

              return (
                <div
                  key={goal.id}
                  className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${goal.color}20`, color: goal.color }}
                      >
                        {renderIcon(goal.icon, 22)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                          {goal.name}
                        </h3>
                        {goal.targetScore && (
                          <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            目標: {goal.targetScore}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleComplete(goal)}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                        title="達成済みにする"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEditModal(goal)}
                        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(goal.id)}
                        className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {goal.description && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                      {goal.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                      <Calendar className="w-4 h-4" />
                      <span>
                        {new Date(goal.examDate).toLocaleDateString("ja-JP", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                    <div
                      className={`text-lg font-bold ${
                        isUrgent
                          ? "text-red-600"
                          : isNear
                          ? "text-amber-600"
                          : "text-emerald-600"
                      }`}
                    >
                      {daysRemaining > 0
                        ? `あと${daysRemaining}日`
                        : daysRemaining === 0
                        ? "今日!"
                        : `${Math.abs(daysRemaining)}日経過`}
                    </div>
                  </div>

                  {goal._count && goal._count.tasks > 0 && (
                    <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-700">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {goal._count.tasks}個の関連タスク
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 達成済み */}
      {completedGoals.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            達成済み
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {completedGoals.map((goal) => (
              <div
                key={goal.id}
                className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 opacity-75"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${goal.color}20`, color: goal.color }}
                    >
                      {renderIcon(goal.icon, 22)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-zinc-700 dark:text-zinc-300 line-through">
                        {goal.name}
                      </h3>
                      {goal.actualScore && (
                        <p className="text-sm text-emerald-600 dark:text-emerald-400">
                          結果: {goal.actualScore}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(goal.id)}
                    className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <Calendar className="w-4 h-4" />
                  <span>
                    {new Date(goal.examDate).toLocaleDateString("ja-JP")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {examGoals.length === 0 && (
        <div className="text-center py-12">
          <Target className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
          <p className="text-zinc-500 dark:text-zinc-400">
            試験目標がありません。新規作成から追加してください。
          </p>
        </div>
      )}

      {/* モーダル */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
                {editingGoal ? "試験目標を編集" : "新しい試験目標"}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    試験名 *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="例: TOEIC、基本情報技術者試験"
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    試験日 *
                  </label>
                  <input
                    type="date"
                    value={formData.examDate}
                    onChange={(e) =>
                      setFormData({ ...formData, examDate: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    目標スコア/点数
                  </label>
                  <input
                    type="text"
                    value={formData.targetScore}
                    onChange={(e) =>
                      setFormData({ ...formData, targetScore: e.target.value })
                    }
                    placeholder="例: 800点、合格"
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    説明（任意）
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder="目標の詳細や意気込みなど"
                    rows={2}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    カラー
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFormData({ ...formData, color })}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          formData.color === color
                            ? "border-zinc-900 dark:border-white scale-110"
                            : "border-transparent hover:scale-105"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    アイコン
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowIconPicker(!showIconPicker)}
                    className="flex items-center gap-2 px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors"
                  >
                    <span style={{ color: formData.color }}>
                      {renderIcon(formData.icon, 20)}
                    </span>
                    <span className="text-sm">
                      {formData.icon || "アイコンを選択"}
                    </span>
                  </button>

                  {showIconPicker && (
                    <div className="mt-2 p-3 border border-zinc-200 dark:border-zinc-600 rounded-lg bg-zinc-50 dark:bg-zinc-700">
                      <input
                        type="text"
                        value={iconSearch}
                        onChange={(e) => setIconSearch(e.target.value)}
                        placeholder="アイコンを検索...（例: 本、仕事、星）"
                        className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <div className="grid grid-cols-6 gap-1 max-h-40 overflow-y-auto">
                        {filteredIcons.map((iconName) => (
                          <button
                            key={iconName}
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, icon: iconName });
                              setShowIconPicker(false);
                              setIconSearch("");
                            }}
                            className={`p-2 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors ${
                              formData.icon === iconName
                                ? "bg-zinc-200 dark:bg-zinc-600"
                                : ""
                            }`}
                            title={iconName}
                          >
                            {renderIcon(iconName, 18)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                  >
                    {editingGoal ? "更新" : "作成"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
