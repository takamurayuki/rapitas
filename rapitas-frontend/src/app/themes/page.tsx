"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  Search,
  Star,
  SwatchBook,
  Code,
  FolderGit2,
  GitBranch,
  FolderOpen,
} from "lucide-react";
import { useToast } from "@/components/ui/toast/ToastContainer";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { DirectoryPicker } from "@/components/ui/DirectoryPicker";
import {
  ICON_DATA,
  searchIcons,
  getIconComponent,
} from "@/components/category/IconData";
import type { Theme } from "@/types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

// 作業ディレクトリをお気に入りに自動登録する関数
const addWorkingDirectoryToFavorites = async (path: string) => {
  if (!path.trim()) return;

  try {
    // まず既にお気に入りに登録されているか確認
    const checkRes = await fetch(`${API_BASE}/directories/favorites`);
    const favorites = await checkRes.json();

    if (!Array.isArray(favorites)) return;

    const isAlreadyFavorite = favorites.some(
      (f: { path: string }) => f.path === path,
    );
    if (isAlreadyFavorite) return;

    // お気に入りに追加
    await fetch(`${API_BASE}/directories/favorites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  } catch (err) {
    console.error("Failed to add working directory to favorites:", err);
  }
};

type FormData = {
  name: string;
  description: string;
  color: string;
  icon: string;
  isDevelopment: boolean;
  repositoryUrl: string;
  workingDirectory: string;
  defaultBranch: string;
};

const defaultFormData: FormData = {
  name: "",
  description: "",
  color: "#8B5CF6",
  icon: "",
  isDevelopment: false,
  repositoryUrl: "",
  workingDirectory: "",
  defaultBranch: "main",
};

export default function ThemesPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [iconSearchQuery, setIconSearchQuery] = useState("");
  const [formData, setFormData] = useState<FormData>(defaultFormData);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/themes`);
      if (!res.ok) throw new Error("取得に失敗しました");
      setItems(await res.json());
    } catch (e) {
      console.error(e);
      showToast("テーマの取得に失敗しました", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleAdd = async () => {
    if (!formData.name.trim()) {
      showToast("テーマ名を入力してください", "error");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/themes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error("作成に失敗しました");

      // 開発プロジェクトの場合、作業ディレクトリをお気に入りに自動登録
      if (formData.isDevelopment && formData.workingDirectory) {
        await addWorkingDirectoryToFavorites(formData.workingDirectory);
      }

      showToast("テーマを作成しました", "success");
      setIsAdding(false);
      resetForm();
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast("テーマの作成に失敗しました", "error");
    }
  };

  const handleUpdate = async (id: number) => {
    if (!formData.name.trim()) {
      showToast("テーマ名を入力してください", "error");
      return;
    }

    try {
      console.log("Updating theme with data:", formData);
      const res = await fetch(`${API_BASE}/themes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const responseText = await res.text();
      console.log("Response status:", res.status, "Response:", responseText);

      if (!res.ok) {
        let errorMessage = `更新に失敗しました (${res.status})`;
        try {
          const errorData = JSON.parse(responseText);
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch {
          // JSONパースに失敗した場合はテキストをそのまま使用
          if (responseText) {
            errorMessage = responseText;
          }
        }
        throw new Error(errorMessage);
      }

      // 開発プロジェクトの場合、作業ディレクトリをお気に入りに自動登録
      if (formData.isDevelopment && formData.workingDirectory) {
        await addWorkingDirectoryToFavorites(formData.workingDirectory);
      }

      showToast("テーマを更新しました", "success");
      setEditingId(null);
      setIconSearchQuery("");
      fetchItems();
    } catch (e) {
      console.error("Theme update error:", e);
      showToast(
        e instanceof Error ? e.message : "テーマの更新に失敗しました",
        "error",
      );
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return;

    try {
      const res = await fetch(`${API_BASE}/themes/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("削除に失敗しました");

      showToast("テーマを削除しました", "success");
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast("テーマの削除に失敗しました", "error");
    }
  };

  const setDefault = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/themes/${id}/set-default`, {
        method: "PATCH",
      });

      if (!res.ok) throw new Error("デフォルト設定に失敗しました");

      showToast("デフォルトテーマを設定しました", "success");
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast("デフォルトテーマの設定に失敗しました", "error");
    }
  };

  const startEdit = (item: Theme) => {
    setEditingId(item.id);
    setFormData({
      name: item.name,
      description: item.description || "",
      color: item.color,
      icon: item.icon || "",
      isDevelopment: item.isDevelopment || false,
      repositoryUrl: item.repositoryUrl || "",
      workingDirectory: item.workingDirectory || "",
      defaultBranch: item.defaultBranch || "main",
    });
    setIconSearchQuery("");
  };

  const resetForm = () => {
    setFormData(defaultFormData);
    setIconSearchQuery("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsAdding(false);
    resetForm();
  };

  const filteredIcons = searchIcons(iconSearchQuery);

  const renderIcon = (iconName: string | null | undefined, size = 20) => {
    const IconComponent = getIconComponent(iconName || "");
    if (!IconComponent) {
      const DefaultIcon =
        getIconComponent("SwatchBook") || ICON_DATA["SwatchBook"].component;
      return <DefaultIcon size={size} />;
    }
    return <IconComponent size={size} />;
  };

  const renderForm = (isEdit: boolean, itemId?: number) => (
    <div className="space-y-6">
      {/* 基本情報 */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
          <SwatchBook className="w-4 h-4" />
          基本情報
        </h3>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            テーマ名 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="テーマ名を入力"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
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
            placeholder="説明を入力"
            rows={2}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all resize-none"
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
                className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all font-mono"
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
            アイコンを選択 {!formData.icon && "(未選択時: SwatchBook)"}
          </label>

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={iconSearchQuery}
              onChange={(e) => setIconSearchQuery(e.target.value)}
              placeholder="アイコンを検索...（例: 本、仕事、星）"
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            />
          </div>

          <div className="max-h-48 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
            <div className="grid grid-cols-8 gap-1 p-2">
              {filteredIcons.length > 0 ? (
                filteredIcons.map((iconName) => {
                  const isSelected = formData.icon === iconName;
                  return (
                    <button
                      key={iconName}
                      type="button"
                      onClick={() =>
                        setFormData({ ...formData, icon: iconName })
                      }
                      className={`p-2.5 rounded-lg transition-all ${
                        isSelected
                          ? "bg-purple-500 text-white shadow-lg scale-105"
                          : "hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:scale-105"
                      }`}
                      title={iconName}
                    >
                      <div className="flex items-center justify-center">
                        {renderIcon(iconName, 18)}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="col-span-8 text-center py-6 text-sm text-zinc-500 dark:text-zinc-400">
                  一致するアイコンがありません
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 開発プロジェクト設定 */}
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
            <Code className="w-4 h-4" />
            開発プロジェクト設定
          </h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.isDevelopment}
              onChange={(e) =>
                setFormData({ ...formData, isDevelopment: e.target.checked })
              }
              className="w-4 h-4 rounded border-zinc-300 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              開発プロジェクトとして設定
            </span>
          </label>
        </div>

        {formData.isDevelopment && (
          <div className="space-y-4 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <p className="text-xs text-purple-700 dark:text-purple-300">
              開発プロジェクトとして設定すると、このテーマのタスクでAI開発モードを使用する際に、以下の設定が自動適用されます。
            </p>

            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-2">
                <FolderGit2 className="w-4 h-4" />
                GitHubリポジトリURL
              </label>
              <input
                type="text"
                value={formData.repositoryUrl}
                onChange={(e) =>
                  setFormData({ ...formData, repositoryUrl: e.target.value })
                }
                placeholder="https://github.com/username/repository"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-2">
                <FolderOpen className="w-4 h-4" />
                作業ディレクトリ（ローカルパス）
              </label>
              <DirectoryPicker
                value={formData.workingDirectory}
                onChange={(path) =>
                  setFormData({ ...formData, workingDirectory: path })
                }
                placeholder="C:\Projects\my-project または /home/user/projects/my-project"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Claude
                Codeがコード変更を行うローカルのプロジェクトフォルダを指定してください。「参照」ボタンでフォルダを選択できます。
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-2">
                <GitBranch className="w-4 h-4" />
                デフォルトブランチ
              </label>
              <input
                type="text"
                value={formData.defaultBranch}
                onChange={(e) =>
                  setFormData({ ...formData, defaultBranch: e.target.value })
                }
                placeholder="main"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              />
            </div>
          </div>
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
            isEdit && itemId ? handleUpdate(itemId) : handleAdd()
          }
          className="flex items-center gap-2 rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2.5 text-white transition-all shadow-lg hover:shadow-xl font-medium"
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
              <SwatchBook className="w-8 h-8 text-purple-600 dark:text-purple-400" />
              テーマ一覧
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              テーマを管理します。開発プロジェクトの設定もここで行えます。
            </p>
          </div>
          {!isAdding && (
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 rounded-lg bg-purple-600 hover:bg-purple-700 px-5 py-2.5 text-white transition-all shadow-lg hover:shadow-xl font-medium"
            >
              <Plus className="w-5 h-5" />
              新規テーマ
            </button>
          )}
        </div>

        {/* 新規追加フォーム */}
        {isAdding && (
          <div className="mb-6 rounded-xl border-2 border-purple-500 bg-white dark:bg-zinc-900 p-6 shadow-xl">
            {renderForm(false)}
          </div>
        )}

        {/* リスト */}
        {loading ? (
          <LoadingSpinner color="purple" />
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <SwatchBook className="w-16 h-16 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
            <p className="text-lg font-medium mb-2">テーマがありません</p>
            <p className="text-sm mb-4">最初のテーマを作成してみましょう</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {items
              .filter(
                (item) =>
                  !isAdding && (editingId === null || editingId === item.id),
              )
              .map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:shadow-lg transition-all overflow-hidden"
                >
                  {editingId === item.id ? (
                    <div className="p-6">
                      <h2 className="mb-4 text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                        <Edit2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        テーマを編集
                      </h2>
                      {renderForm(true, item.id)}
                    </div>
                  ) : (
                    <div className="p-5 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div
                          className="flex items-center justify-center w-14 h-14 rounded-xl shrink-0 shadow-sm"
                          style={{
                            backgroundColor: item.color + "20",
                            color: item.color,
                          }}
                        >
                          {renderIcon(item.icon, 28)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 truncate">
                              {item.name}
                            </h3>
                            {item.isDevelopment && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                <Code className="w-3 h-3" />
                                開発
                              </span>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5 line-clamp-2">
                              {item.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            <span
                              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md"
                              style={{
                                backgroundColor: item.color + "15",
                                color: item.color,
                              }}
                            >
                              <div
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: item.color }}
                              />
                              {item.color}
                            </span>
                            {item._count && (
                              <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                <span className="font-semibold">
                                  {item._count.tasks}
                                </span>
                                タスク
                              </span>
                            )}
                            {item.isDevelopment && item.workingDirectory && (
                              <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1 font-mono">
                                <FolderOpen className="w-3 h-3" />
                                {item.workingDirectory.length > 40
                                  ? "..." + item.workingDirectory.slice(-37)
                                  : item.workingDirectory}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setDefault(item.id)}
                          className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all font-medium ${
                            item.isDefault
                              ? "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border-2 border-purple-500"
                              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                          }`}
                        >
                          <Star
                            className={`w-4 h-4 ${item.isDefault ? "fill-current" : ""}`}
                          />
                          {item.isDefault ? "デフォルト" : "デフォルト設定"}
                        </button>
                        <button
                          onClick={() => startEdit(item)}
                          className="flex items-center gap-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 px-3 py-2 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-all font-medium"
                        >
                          <Edit2 className="w-4 h-4" />
                          編集
                        </button>
                        <button
                          onClick={() => handleDelete(item.id, item.name)}
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
