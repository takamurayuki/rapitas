"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Label } from "@/types";
import {
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  Search,
  Tag,
  Book,
  Briefcase,
  Code,
  Coffee,
  Cpu,
  Dumbbell,
  Gamepad2,
  GraduationCap,
  Heart,
  Home,
  Lightbulb,
  Music,
  Plane,
  Rocket,
  ShoppingBag,
  Sparkles,
  Star,
  Target,
  Trophy,
  Umbrella,
  Zap,
  Camera,
  Film,
  Headphones,
  Laptop,
  Smartphone,
  Tv,
  Watch,
  Globe,
  MapPin,
  Mountain,
  Sun,
  Moon,
  Cloud,
  Droplet,
  Flame,
  Leaf,
  Flower2,
  Trees,
  Fish,
  Bird,
  Bug,
  Cat,
  Dog,
  Pizza,
  Utensils,
  IceCream,
  Cake,
  Apple,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/components/ui/toast/toast-container";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

// Lucideアイコンのマッピング
const ICON_MAP: Record<string, LucideIcon> = {
  Tag,
  Book,
  Briefcase,
  Code,
  Coffee,
  Cpu,
  Dumbbell,
  Gamepad2,
  GraduationCap,
  Heart,
  Home,
  Lightbulb,
  Music,
  Plane,
  Rocket,
  ShoppingBag,
  Sparkles,
  Star,
  Target,
  Trophy,
  Umbrella,
  Zap,
  Camera,
  Film,
  Headphones,
  Laptop,
  Smartphone,
  Tv,
  Watch,
  Globe,
  MapPin,
  Mountain,
  Sun,
  Moon,
  Cloud,
  Droplet,
  Flame,
  Leaf,
  Flower2,
  Trees,
  Fish,
  Bird,
  Bug,
  Cat,
  Dog,
  Pizza,
  Utensils,
  IceCream,
  Cake,
  Apple,
};

const ICON_OPTIONS = Object.keys(ICON_MAP);

export default function LabelsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [iconSearchQuery, setIconSearchQuery] = useState("");

  // フォーム状態
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    color: "#6366F1",
    icon: "",
  });

  const fetchLabels = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/labels`);
      if (!res.ok) throw new Error("取得に失敗しました");
      const data = await res.json();
      setLabels(data);
    } catch (e) {
      console.error(e);
      showToast("ラベルの取得に失敗しました", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLabels();
  }, []);

  const handleAdd = async () => {
    if (!formData.name.trim()) {
      showToast("ラベル名を入力してください", "error");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error("作成に失敗しました");

      showToast("ラベルを作成しました", "success");
      setIsAdding(false);
      setFormData({ name: "", description: "", color: "#6366F1", icon: "" });
      setIconSearchQuery("");
      fetchLabels();
    } catch (e) {
      console.error(e);
      showToast("ラベルの作成に失敗しました", "error");
    }
  };

  const handleUpdate = async (id: number) => {
    if (!formData.name.trim()) {
      showToast("ラベル名を入力してください", "error");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/labels/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error("更新に失敗しました");

      showToast("ラベルを更新しました", "success");
      setEditingId(null);
      setIconSearchQuery("");
      fetchLabels();
    } catch (e) {
      console.error(e);
      showToast("ラベルの更新に失敗しました", "error");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return;

    try {
      const res = await fetch(`${API_BASE}/labels/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("削除に失敗しました");

      showToast("ラベルを削除しました", "success");
      fetchLabels();
    } catch (e) {
      console.error(e);
      showToast("ラベルの削除に失敗しました", "error");
    }
  };

  const startEdit = (label: Label) => {
    setEditingId(label.id);
    setFormData({
      name: label.name,
      description: label.description || "",
      color: label.color,
      icon: label.icon || "",
    });
    setIconSearchQuery("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsAdding(false);
    setFormData({ name: "", description: "", color: "#6366F1", icon: "" });
    setIconSearchQuery("");
  };

  const filteredIcons = ICON_OPTIONS.filter((iconName) =>
    iconName.toLowerCase().includes(iconSearchQuery.toLowerCase()),
  );

  const renderIcon = (iconName: string | null | undefined, size = 20) => {
    if (!iconName || !ICON_MAP[iconName]) {
      const DefaultIcon = ICON_MAP["Tag"];
      return <DefaultIcon size={size} />;
    }
    const IconComponent = ICON_MAP[iconName];
    return <IconComponent size={size} />;
  };

  const renderFormContent = (isEdit: boolean, labelId?: number) => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          ラベル名 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="例: バグ修正、機能追加、ドキュメント"
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          説明（任意）
        </label>
        <textarea
          value={formData.description}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value })
          }
          placeholder="ラベルの説明を入力"
          rows={2}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            カラー
          </label>
          <div className="flex gap-3 items-center">
            <input
              type="color"
              value={formData.color}
              onChange={(e) =>
                setFormData({ ...formData, color: e.target.value })
              }
              className="h-11 w-16 rounded-lg border border-zinc-300 dark:border-zinc-700 cursor-pointer"
            />
            <input
              type="text"
              value={formData.color}
              onChange={(e) =>
                setFormData({ ...formData, color: e.target.value })
              }
              className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            選択中のアイコン
          </label>
          <div
            className="h-11 rounded-lg border-2 flex items-center justify-center"
            style={{
              borderColor: formData.color,
              backgroundColor: formData.color + "15",
            }}
          >
            <div style={{ color: formData.color }}>
              {renderIcon(formData.icon, 24)}
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          アイコンを選択 {!formData.icon && "(未選択時: Tag)"}
        </label>

        {/* 検索バー */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={iconSearchQuery}
            onChange={(e) => setIconSearchQuery(e.target.value)}
            placeholder="アイコンを検索... (例: book, code, star)"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
          />
        </div>

        {/* アイコングリッド */}
        <div className="max-h-64 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
          <div className="grid grid-cols-8 gap-1 p-2">
            {filteredIcons.length > 0 ? (
              filteredIcons.map((iconName) => {
                const isSelected = formData.icon === iconName;
                return (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => setFormData({ ...formData, icon: iconName })}
                    className={`relative group p-3 rounded-lg transition-all ${
                      isSelected
                        ? "bg-indigo-500 text-white shadow-lg scale-105"
                        : "hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:scale-105"
                    }`}
                    title={iconName}
                  >
                    <div className="flex items-center justify-center">
                      {renderIcon(iconName, 20)}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="col-span-8 text-center py-8 text-sm text-zinc-500 dark:text-zinc-400">
                「{iconSearchQuery}」に一致するアイコンが見つかりません
              </div>
            )}
          </div>
        </div>
        {filteredIcons.length > 0 && (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {filteredIcons.length} 個のアイコンが表示されています
          </p>
        )}
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <button
          onClick={cancelEdit}
          className="flex items-center gap-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 px-4 py-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-all font-medium"
        >
          <X className="w-4 h-4" />
          キャンセル
        </button>
        <button
          onClick={() =>
            isEdit && labelId ? handleUpdate(labelId) : handleAdd()
          }
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-white hover:bg-indigo-700 transition-all shadow-lg hover:shadow-xl font-medium"
        >
          <Save className="w-4 h-4" />
          {isEdit ? "保存" : "作成"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* ヘッダー */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-3">
              <Tag className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
              ラベル一覧
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              タスクに付けるラベルを管理します
            </p>
          </div>
          {!isAdding && (
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 transition-all shadow-lg hover:shadow-xl font-medium"
            >
              <Plus className="w-5 h-5" />
              新規ラベル
            </button>
          )}
        </div>

        {/* 新規追加フォーム */}
        {isAdding && (
          <div className="mb-6 rounded-xl border-2 border-indigo-500 bg-white dark:bg-zinc-900 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Plus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              新規ラベル作成
            </h2>
            {renderFormContent(false)}
          </div>
        )}

        {/* ラベルリスト */}
        {loading ? (
          <div className="text-center py-16 text-zinc-500 dark:text-zinc-400">
            <div className="inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p>読み込み中...</p>
          </div>
        ) : labels.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <Tag className="w-16 h-16 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
            <p className="text-lg font-medium mb-2">ラベルがありません</p>
            <p className="text-sm mb-4">最初のラベルを作成してみましょう</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {labels.map((label) => (
              <div
                key={label.id}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:shadow-lg transition-all overflow-hidden"
              >
                {editingId === label.id ? (
                  // 編集モード
                  <div className="p-6">
                    <h2 className="mb-4 text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                      <Edit2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                      ラベルを編集
                    </h2>
                    {renderFormContent(true, label.id)}
                  </div>
                ) : (
                  // 表示モード
                  <div className="p-5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div
                        className="flex items-center justify-center w-14 h-14 rounded-xl shrink-0 shadow-sm"
                        style={{
                          backgroundColor: label.color + "20",
                          color: label.color,
                        }}
                      >
                        {renderIcon(label.icon, 28)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 truncate">
                          {label.name}
                        </h3>
                        {label.description && (
                          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5 line-clamp-2">
                            {label.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-2">
                          <span
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md"
                            style={{
                              backgroundColor: label.color + "15",
                              color: label.color,
                            }}
                          >
                            <div
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: label.color }}
                            ></div>
                            {label.color}
                          </span>
                          {label._count && (
                            <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                              <span className="font-semibold">
                                {label._count.tasks}
                              </span>
                              タスク
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => startEdit(label)}
                        className="flex items-center gap-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 px-3 py-2 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-all font-medium"
                      >
                        <Edit2 className="w-4 h-4" />
                        編集
                      </button>
                      <button
                        onClick={() => handleDelete(label.id, label.name)}
                        className="flex items-center gap-2 rounded-lg bg-red-100 dark:bg-red-900/30 px-3 py-2 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-all font-medium"
                      >
                        <Trash2 className="w-4 h-4" />
                        削除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
