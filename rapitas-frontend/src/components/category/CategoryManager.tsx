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
  GripVertical,
  type LucideIcon,
} from "lucide-react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { useToast } from "@/components/ui/toast/ToastContainer";
import { ListSkeleton } from "@/components/ui/LoadingSpinner";
import {
  ICON_DATA,
  ICON_NAMES,
  searchIcons,
  getIconComponent,
} from "./IconData";
import { API_BASE_URL } from "@/utils/api";
import { useDebounce } from "@/hooks/useDebounce";
import { IconGrid } from "./IconGrid";

// 後方互換性のためにICON_MAPをエクスポート
export const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  ICON_NAMES.map((name) => [name, ICON_DATA[name].component]),
);

// 共通のカテゴリアイテム型
export type CategoryItem = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  isDefault?: boolean;
  _count?: { tasks: number };
};

// 設定オプション
export type CategoryManagerConfig = {
  // 表示名
  title: string;
  titleIcon: LucideIcon;
  itemName: string; // "テーマ" or "ラベル"
  // API
  endpoint: string;
  // スタイル
  accentColor: string; // "purple" or "indigo"
  defaultColor: string; // "#8B5CF6" or "#6366F1"
  defaultIcon: string; // "SwatchBook" or "Tag"
  // 機能
  showDefaultButton?: boolean;
};

type Props = {
  config: CategoryManagerConfig;
};

export default function CategoryManager({ config }: Props) {
  const { showToast } = useToast();
  const [items, setItems] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [iconSearchQuery, setIconSearchQuery] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    color: config.defaultColor,
    icon: "",
  });

  const accentClasses = {
    purple: {
      ring: "focus:ring-purple-500",
      border: "border-purple-500",
      bg: "bg-purple-600 hover:bg-purple-700",
      bgLight: "bg-purple-100 dark:bg-purple-900/30",
      text: "text-purple-600 dark:text-purple-400",
      iconBg: "bg-purple-500",
      dragRing: "ring-purple-500/50",
    },
    indigo: {
      ring: "focus:ring-indigo-500",
      border: "border-indigo-500",
      bg: "bg-indigo-600 hover:bg-indigo-700",
      bgLight: "bg-indigo-100 dark:bg-indigo-900/30",
      text: "text-indigo-600 dark:text-indigo-400",
      iconBg: "bg-indigo-500",
      dragRing: "ring-indigo-500/50",
    },
  };

  const accent =
    accentClasses[config.accentColor as keyof typeof accentClasses] ||
    accentClasses.indigo;

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/${config.endpoint}`);
      if (!res.ok) throw new Error("取得に失敗しました");
      setItems(await res.json());
    } catch (e) {
      console.error(e);
      showToast(`${config.itemName}の取得に失敗しました`, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleAdd = async () => {
    if (!formData.name.trim()) {
      showToast(`${config.itemName}名を入力してください`, "error");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/${config.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error("作成に失敗しました");

      showToast(`${config.itemName}を作成しました`, "success");
      setIsAdding(false);
      resetForm();
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast(`${config.itemName}の作成に失敗しました`, "error");
    }
  };

  const handleUpdate = async (id: number) => {
    if (!formData.name.trim()) {
      showToast(`${config.itemName}名を入力してください`, "error");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/${config.endpoint}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error("更新に失敗しました");

      showToast(`${config.itemName}を更新しました`, "success");
      setEditingId(null);
      setIconSearchQuery("");
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast(`${config.itemName}の更新に失敗しました`, "error");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return;

    try {
      const res = await fetch(`${API_BASE_URL}/${config.endpoint}/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("削除に失敗しました");

      showToast(`${config.itemName}を削除しました`, "success");
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast(`${config.itemName}の削除に失敗しました`, "error");
    }
  };

  const setDefault = async (id: number) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/${config.endpoint}/${id}/set-default`,
        {
          method: "PATCH",
        },
      );

      if (!res.ok) throw new Error("デフォルト設定に失敗しました");

      showToast(`デフォルト${config.itemName}を設定しました`, "success");
      fetchItems();
    } catch (e) {
      console.error(e);
      showToast(`デフォルト${config.itemName}の設定に失敗しました`, "error");
    }
  };

  const startEdit = (item: CategoryItem) => {
    setEditingId(item.id);
    setFormData({
      name: item.name,
      description: item.description || "",
      color: item.color,
      icon: item.icon || "",
    });
    setIconSearchQuery("");
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      color: config.defaultColor,
      icon: "",
    });
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
      const res = await fetch(`${API_BASE_URL}/${config.endpoint}/reorder`, {
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
    if (!IconComponent) {
      const DefaultIcon =
        getIconComponent(config.defaultIcon) || ICON_DATA["Tag"].component;
      return <DefaultIcon size={size} />;
    }
    return <IconComponent size={size} />;
  };

  const TitleIcon = config.titleIcon;

  const renderForm = (isEdit: boolean, itemId?: number) => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          {config.itemName}名 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={`${config.itemName}名を入力`}
          className={`w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 ${accent.ring} focus:border-transparent transition-all`}
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
          className={`w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 ${accent.ring} focus:border-transparent transition-all resize-none`}
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
              className={`flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 ${accent.ring} focus:border-transparent transition-all font-mono`}
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
          アイコンを選択 {!formData.icon && `(未選択時: ${config.defaultIcon})`}
        </label>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={iconSearchQuery}
            onChange={(e) => setIconSearchQuery(e.target.value)}
            placeholder="アイコンを検索...（例: 本、仕事、星）"
            className={`w-full pl-10 pr-4 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 ${accent.ring} focus:border-transparent transition-all`}
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
              accentClass={accent.iconBg}
            />
          </div>
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
          className={`flex items-center gap-2 rounded-lg ${accent.bg} px-4 py-2.5 text-white transition-all shadow-lg hover:shadow-xl font-medium`}
        >
          <Save className="w-4 h-4" />
          {isEdit ? "保存" : "作成"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* ヘッダー */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1
              className={`text-3xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-3`}
            >
              <TitleIcon className={`w-8 h-8 ${accent.text}`} />
              {config.title}
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {config.itemName}を管理します
            </p>
          </div>
          {!isAdding && (
            <button
              onClick={() => setIsAdding(true)}
              className={`flex items-center gap-2 rounded-lg ${accent.bg} px-5 py-2.5 text-white transition-all shadow-lg hover:shadow-xl font-medium`}
            >
              <Plus className="w-5 h-5" />
              新規{config.itemName}
            </button>
          )}
        </div>

        {/* 新規追加フォーム */}
        {isAdding && (
          <div
            className={`mb-6 rounded-xl border-2 ${accent.border} bg-white dark:bg-zinc-900 p-6 shadow-xl`}
          >
            <h2 className="mb-4 text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Plus className={`w-5 h-5 ${accent.text}`} />
              新規{config.itemName}作成
            </h2>
            {renderForm(false)}
          </div>
        )}

        {/* リスト */}
        {loading ? (
          <ListSkeleton count={4} />
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <TitleIcon className="w-16 h-16 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
            <p className="text-lg font-medium mb-2">
              {config.itemName}がありません
            </p>
            <p className="text-sm mb-4">
              最初の{config.itemName}を作成してみましょう
            </p>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId={config.endpoint}>
              {(provided) => (
                <div className="grid gap-4" ref={provided.innerRef} {...provided.droppableProps}>
                  {items
                    .filter((item) => {
                      if (isAdding) return false;
                      if (editingId !== null) return item.id === editingId;
                      return true;
                    })
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
                            className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:shadow-lg transition-all overflow-hidden ${
                              snapshot.isDragging ? `shadow-2xl ring-2 ${accent.dragRing}` : ""
                            }`}
                          >
                            {editingId === item.id ? (
                              <div className="p-6">
                                <h2 className="mb-4 text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                                  <Edit2 className={`w-5 h-5 ${accent.text}`} />
                                  {config.itemName}を編集
                                </h2>
                                {renderForm(true, item.id)}
                              </div>
                            ) : (
                              <div className="p-5 flex items-center justify-between gap-4">
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
                                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 truncate">
                                      {item.name}
                                    </h3>
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
                                      {item._count && (
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                          <span className="font-semibold">
                                            {item._count.tasks}
                                          </span>
                                          タスク
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {config.showDefaultButton && (
                                    <button
                                      onClick={() => setDefault(item.id)}
                                      className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all font-medium ${
                                        item.isDefault
                                          ? `${accent.bgLight} ${accent.text} border-2 ${accent.border}`
                                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                      }`}
                                    >
                                      <Star
                                        className={`w-4 h-4 ${item.isDefault ? "fill-current" : ""}`}
                                      />
                                      {item.isDefault ? "デフォルト" : "デフォルト設定"}
                                    </button>
                                  )}
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
