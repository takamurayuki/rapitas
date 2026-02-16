"use client";
import { useEffect, useState, useMemo } from "react";
import {
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  Search,
  Star,
  FolderKanban,
  SwatchBook,
  Code,
  BookOpen,
  Layers,
  GripVertical,
} from "lucide-react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { useToast } from "@/components/ui/toast/ToastContainer";
import { ListSkeleton } from "@/components/ui/LoadingSpinner";
import {
  searchIcons,
  getIconComponent,
} from "@/components/category/IconData";
import type { Category, CategoryMode, Theme } from "@/types";
import { API_BASE_URL } from "@/utils/api";
import { useDebounce } from "@/hooks/useDebounce";
import { IconGrid } from "@/components/category/IconGrid";

type CategoryWithThemes = Category & {
  themes: (Pick<Theme, "id" | "name" | "color" | "icon" | "isDefault"> & {
    _count?: { tasks: number };
  })[];
};

type FormData = {
  name: string;
  description: string;
  color: string;
  icon: string;
  mode: CategoryMode;
};

const defaultFormData: FormData = {
  name: "",
  description: "",
  color: "#6366F1",
  icon: "",
  mode: "both",
};

const MODE_OPTIONS: { value: CategoryMode; label: string; icon: typeof Code; color: string }[] = [
  { value: "development", label: "開発", icon: Code, color: "#3B82F6" },
  { value: "learning", label: "学習", icon: BookOpen, color: "#10B981" },
  { value: "both", label: "両方", icon: Layers, color: "#8B5CF6" },
];

export default function CategoriesPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<CategoryWithThemes[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [iconSearchQuery, setIconSearchQuery] = useState("");
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [defaultCategoryId, setDefaultCategoryId] = useState<number | null>(null);

  const seedDefaults = async () => {
    try {
      await fetch(`${API_BASE_URL}/categories/seed-defaults`, {
        method: "POST",
      });
    } catch (e) {
      console.error("Failed to seed default categories:", e);
    }
  };

  const fetchDefaultCategory = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings`);
      if (res.ok) {
        const data = await res.json();
        setDefaultCategoryId(data.defaultCategoryId ?? null);
      }
    } catch (e) {
      console.error("Failed to fetch default category:", e);
    }
  };

  const setDefaultCategory = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/categories/${id}/set-default`, {
        method: "PATCH",
      });

      if (!res.ok) throw new Error("デフォルト設定に失敗しました");

      setDefaultCategoryId(id);
      // タスク一覧画面で新しいデフォルトが反映されるようlocalStorageを更新
      localStorage.setItem("selectedCategoryFilter", String(id));
      showToast("デフォルトカテゴリを設定しました", "success");
    } catch (e) {
      console.error(e);
      showToast("デフォルトカテゴリの設定に失敗しました", "error");
    }
  };

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/categories`);
      if (!res.ok) throw new Error("取得に失敗しました");
      setItems(await res.json());
    } catch (e) {
      console.error(e);
      showToast("カテゴリの取得に失敗しました", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    seedDefaults().then(() => {
      fetchItems();
      fetchDefaultCategory();
    });
  }, []);

  const handleAdd = async () => {
    if (!formData.name.trim()) {
      showToast("カテゴリ名を入力してください", "error");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error("作成に失敗しました");

      showToast("カテゴリを作成しました", "success");
      setIsAdding(false);
      resetForm();
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast("カテゴリの作成に失敗しました", "error");
    }
  };

  const handleUpdate = async (id: number) => {
    if (!formData.name.trim()) {
      showToast("カテゴリ名を入力してください", "error");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error("更新に失敗しました");

      showToast("カテゴリを更新しました", "success");
      setEditingId(null);
      setIconSearchQuery("");
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast("カテゴリの更新に失敗しました", "error");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`「${name}」を削除しますか？所属するテーマは別のカテゴリに移動してください。`)) return;

    try {
      const res = await fetch(`${API_BASE_URL}/categories/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("削除に失敗しました");

      showToast("カテゴリを削除しました", "success");
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast("カテゴリの削除に失敗しました", "error");
    }
  };

  const startEdit = (item: CategoryWithThemes) => {
    setEditingId(item.id);
    setFormData({
      name: item.name,
      description: item.description || "",
      color: item.color,
      icon: item.icon || "",
      mode: item.mode || "both",
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

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index) return;

    const reordered = Array.from(items);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);

    setItems(reordered);

    const orders = reordered.map((item, index) => ({
      id: item.id,
      sortOrder: index,
    }));

    try {
      const res = await fetch(`${API_BASE_URL}/categories/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders }),
      });
      if (!res.ok) throw new Error("並び替えに失敗しました");
    } catch (e) {
      console.error(e);
      showToast("並び替えに失敗しました", "error");
      fetchItems();
    }
  };

  // デバウンスされた検索クエリ
  const debouncedIconSearchQuery = useDebounce(iconSearchQuery, 300);

  // メモ化されたアイコン検索結果（最大50個に制限）
  const filteredIcons = useMemo(() => {
    const results = searchIcons(debouncedIconSearchQuery);
    return results.slice(0, 50);
  }, [debouncedIconSearchQuery]);

  const renderIcon = (iconName: string | null | undefined, size = 20) => {
    const IconComponent = getIconComponent(iconName || "");
    if (IconComponent) {
      return <IconComponent size={size} />;
    }
    return <FolderKanban size={size} />;
  };

  const renderForm = (isEdit: boolean, itemId?: number) => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          カテゴリ名 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="カテゴリ名を入力（例: 仕事、学習、生活）"
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
          placeholder="カテゴリの説明を入力"
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
          アイコンを選択 {!formData.icon && "(未選択時: FolderKanban)"}
        </label>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={iconSearchQuery}
            onChange={(e) => setIconSearchQuery(e.target.value)}
            placeholder="アイコンを検索...（例: フォルダ、仕事、星）"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
          />
        </div>

        <div className="max-h-48 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
          {filteredIcons.length === 50 && debouncedIconSearchQuery && (
            <div className="p-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
              表示数が多いため、最初の50件のみ表示しています。絞り込むには検索ワードを追加してください。
            </div>
          )}
          <div className="grid grid-cols-8 gap-1 p-2">
            <IconGrid
              icons={filteredIcons}
              selectedIcon={formData.icon}
              onIconSelect={(iconName) => setFormData({ ...formData, icon: iconName })}
              renderIcon={renderIcon}
              accentClass="bg-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* モード選択 */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          モード
        </label>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
          このカテゴリをどのモードで表示するか選択します
        </p>
        <div className="flex gap-2">
          {MODE_OPTIONS.map((opt) => {
            const ModeIcon = opt.icon;
            const isSelected = formData.mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFormData({ ...formData, mode: opt.value })}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isSelected
                    ? "text-white shadow-md"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700"
                }`}
                style={isSelected ? { backgroundColor: opt.color } : undefined}
              >
                <ModeIcon className="w-4 h-4" />
                {opt.label}
              </button>
            );
          })}
        </div>
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
          className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 text-white transition-all shadow-lg hover:shadow-xl font-medium"
        >
          <Save className="w-4 h-4" />
          {isEdit ? "保存" : "作成"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* ヘッダー */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-3">
              <FolderKanban className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
              カテゴリ一覧
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              カテゴリはテーマの上位分類です。カテゴリ→テーマ→ラベルの順に分類されます。
            </p>
          </div>
          {!isAdding && (
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 text-white transition-all shadow-lg hover:shadow-xl font-medium"
            >
              <Plus className="w-5 h-5" />
              新規カテゴリ
            </button>
          )}
        </div>

        {/* 新規追加フォーム */}
        {isAdding && (
          <div className="mb-6 rounded-xl border-2 border-indigo-500 bg-white dark:bg-indigo-dark-900 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Plus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              新規カテゴリ作成
            </h2>
            {renderForm(false)}
          </div>
        )}

        {/* リスト */}
        {loading ? (
          <ListSkeleton count={4} showBadges />
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 dark:text-zinc-400 bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <FolderKanban className="w-16 h-16 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
            <p className="text-lg font-medium mb-2">カテゴリがありません</p>
            <p className="text-sm mb-4">最初のカテゴリを作成してみましょう（例: 仕事、学習、生活）</p>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="categories">
              {(provided) => (
                <div className="grid gap-4" ref={provided.innerRef} {...provided.droppableProps}>
                  {items
                    .filter(
                      (item) =>
                        !isAdding && (editingId === null || editingId === item.id),
                    )
                    .map((item, index) => (
                      <Draggable
                        key={item.id}
                        draggableId={String(item.id)}
                        index={index}
                        isDragDisabled={editingId !== null || isAdding}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-indigo-dark-900 hover:shadow-lg transition-all overflow-hidden ${
                              snapshot.isDragging ? "shadow-2xl ring-2 ring-indigo-500/50" : ""
                            }`}
                          >
                            {editingId === item.id ? (
                              <div className="p-6">
                                <h2 className="mb-4 text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                                  <Edit2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                                  カテゴリを編集
                                </h2>
                                {renderForm(true, item.id)}
                              </div>
                            ) : (
                              <div className="p-5">
                                <div className="flex items-center justify-between gap-4">
                                  <div className="flex items-center gap-4 flex-1 min-w-0">
                                    <div
                                      {...provided.dragHandleProps}
                                      className="flex items-center justify-center w-6 shrink-0 cursor-grab active:cursor-grabbing text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                                      title="ドラッグして並び替え"
                                    >
                                      <GripVertical className="w-5 h-5" />
                                    </div>
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
                                        {defaultCategoryId === item.id && (
                                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                                            <Star className="w-3 h-3 fill-current" />
                                            デフォルト
                                          </span>
                                        )}
                                        {(() => {
                                          const modeOpt = MODE_OPTIONS.find((m) => m.value === item.mode);
                                          if (!modeOpt) return null;
                                          const ModeIcon = modeOpt.icon;
                                          return (
                                            <span
                                              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                                              style={{
                                                backgroundColor: modeOpt.color + "20",
                                                color: modeOpt.color,
                                              }}
                                            >
                                              <ModeIcon className="w-3 h-3" />
                                              {modeOpt.label}
                                            </span>
                                          );
                                        })()}
                                      </div>
                                      {item.description && (
                                        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5 line-clamp-2">
                                          {item.description}
                                        </p>
                                      )}
                                      <div className="flex items-center gap-3 mt-2">
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
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                          <SwatchBook className="w-3 h-3" />
                                          <span className="font-semibold">
                                            {item._count?.themes ?? item.themes?.length ?? 0}
                                          </span>
                                          テーマ
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      onClick={() => setDefaultCategory(item.id)}
                                      className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all font-medium ${
                                        defaultCategoryId === item.id
                                          ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-2 border-indigo-500"
                                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                      }`}
                                      title={defaultCategoryId === item.id
                                        ? "タスク一覧のデフォルトカテゴリ"
                                        : "タスク一覧のデフォルトカテゴリに設定"}
                                    >
                                      <Star
                                        className={`w-4 h-4 ${defaultCategoryId === item.id ? "fill-current" : ""}`}
                                      />
                                      {defaultCategoryId === item.id ? "デフォルト" : "デフォルト設定"}
                                    </button>
                                    <button
                                      onClick={() => startEdit(item)}
                                      className="flex items-center gap-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 px-3 py-2 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-all font-medium"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                      編集
                                    </button>
                                    {!item.isDefault && (
                                      <button
                                        onClick={() => handleDelete(item.id, item.name)}
                                        className="flex items-center gap-2 rounded-lg bg-red-100 dark:bg-red-900/30 px-3 py-2 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-all font-medium"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                        削除
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* 所属テーマ一覧 */}
                                {item.themes && item.themes.length > 0 && (
                                  <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {item.themes.map((theme) => {
                                        const ThemeIcon = getIconComponent(theme.icon || "") || SwatchBook;
                                        return (
                                          <span
                                            key={theme.id}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium"
                                            style={{
                                              backgroundColor: theme.color + "15",
                                              color: theme.color,
                                            }}
                                          >
                                            <ThemeIcon className="w-3 h-3" />
                                            {theme.name}
                                            {theme._count && (
                                              <span className="opacity-60">
                                                ({theme._count.tasks})
                                              </span>
                                            )}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </div>
    </div>
  );
}
