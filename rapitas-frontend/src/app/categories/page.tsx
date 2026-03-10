'use client';
import { useCallback, useEffect, useState, useMemo } from 'react';
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
} from 'lucide-react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { ListSkeleton } from '@/components/ui/LoadingSpinner';
import { searchIcons, getIconComponent } from '@/components/category/IconData';
import type { Category, CategoryMode, Theme } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { useDebounce } from '@/hooks/useDebounce';
import { IconGrid } from '@/components/category/IconGrid';
import { useFilterDataStore } from '@/stores/filterDataStore';
import { createLogger } from '@/lib/logger';

const logger = createLogger('CategoriesPage');

type CategoryWithThemes = Category & {
  themes: (Pick<Theme, 'id' | 'name' | 'color' | 'icon' | 'isDefault'> & {
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
  name: '',
  description: '',
  color: '#6366F1',
  icon: '',
  mode: 'both',
};

const MODE_OPTIONS: {
  value: CategoryMode;
  labelKey: string;
  icon: typeof Code;
  color: string;
}[] = [
  {
    value: 'development',
    labelKey: 'modeDevelopment',
    icon: Code,
    color: '#3B82F6',
  },
  {
    value: 'learning',
    labelKey: 'modeLearning',
    icon: BookOpen,
    color: '#10B981',
  },
  { value: 'both', labelKey: 'modeBoth', icon: Layers, color: '#8B5CF6' },
];

export default function CategoriesPage() {
  const t = useTranslations('categories');
  const tc = useTranslations('common');
  const { showToast } = useToast();
  const clearFilterCache = useFilterDataStore((s) => s.clearCache);
  const [items, setItems] = useState<CategoryWithThemes[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [iconSearchQuery, setIconSearchQuery] = useState('');
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [defaultCategoryId, setDefaultCategoryId] = useState<number | null>(
    null,
  );

  const seedDefaults = async () => {
    try {
      await fetch(`${API_BASE_URL}/categories/seed-defaults`, {
        method: 'POST',
      });
    } catch (e) {
      logger.error('Failed to seed default categories:', e);
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
      logger.error('Failed to fetch default category:', e);
    }
  };

  const setDefaultCategory = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/categories/${id}/set-default`, {
        method: 'PATCH',
      });

      if (!res.ok) throw new Error(t('setDefaultFailed'));

      setDefaultCategoryId(id);
      localStorage.setItem('selectedCategoryFilter', String(id));
      showToast(t('defaultCategorySet'), 'success');
    } catch (e) {
      logger.error(e);
      showToast(t('defaultCategorySetFailed'), 'error');
    }
  };

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/categories`);
      if (!res.ok) throw new Error(tc('fetchFailed'));
      setItems(await res.json());
    } catch (e) {
      logger.error(e);
      showToast(t('fetchFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    seedDefaults().then(() => {
      fetchItems();
      fetchDefaultCategory();
    });
  }, [fetchItems]);

  const handleAdd = async () => {
    if (!formData.name.trim()) {
      showToast(t('categoryNameRequired'), 'error');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error(tc('createFailed'));

      showToast(t('created'), 'success');
      setIsAdding(false);
      resetForm();
      clearFilterCache();
      fetchItems();
    } catch (e) {
      logger.error(e);
      showToast(t('createFailed'), 'error');
    }
  };

  const handleUpdate = async (id: number) => {
    if (!formData.name.trim()) {
      showToast(t('categoryNameRequired'), 'error');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/categories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error(tc('updateFailed'));

      showToast(t('updated'), 'success');
      setEditingId(null);
      setIconSearchQuery('');
      clearFilterCache();
      fetchItems();
    } catch (e) {
      logger.error(e);
      showToast(t('updateFailed'), 'error');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(t('deleteConfirm', { name }))) return;

    try {
      const res = await fetch(`${API_BASE_URL}/categories/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error(tc('deleteFailed'));

      showToast(t('deleted'), 'success');
      clearFilterCache();
      fetchItems();
    } catch (e) {
      logger.error(e);
      showToast(t('deleteFailed'), 'error');
    }
  };

  const startEdit = (item: CategoryWithThemes) => {
    setEditingId(item.id);
    setFormData({
      name: item.name,
      description: item.description || '',
      color: item.color,
      icon: item.icon || '',
      mode: item.mode || 'both',
    });
    setIconSearchQuery('');
  };

  const resetForm = () => {
    setFormData(defaultFormData);
    setIconSearchQuery('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsAdding(false);
    resetForm();
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index)
      return;

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
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      if (!res.ok) throw new Error(t('reorderFailed'));
      clearFilterCache();
    } catch (e) {
      logger.error(e);
      showToast(t('reorderFailed'), 'error');
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
    const IconComponent = getIconComponent(iconName || '');
    if (IconComponent) {
      return <IconComponent size={size} />;
    }
    return <FolderKanban size={size} />;
  };

  const renderForm = (isEdit: boolean, itemId?: number) => (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {t('categoryNameLabel')} <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={t('categoryNamePlaceholder')}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {tc('descriptionOptional')}
        </label>
        <textarea
          value={formData.description}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value })
          }
          placeholder={t('categoryDescriptionPlaceholder')}
          rows={1}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {tc('color')}
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={formData.color}
              onChange={(e) =>
                setFormData({ ...formData, color: e.target.value })
              }
              className="h-9 w-12 rounded-lg border border-zinc-300 dark:border-zinc-700 cursor-pointer"
            />
            <input
              type="text"
              value={formData.color}
              onChange={(e) =>
                setFormData({ ...formData, color: e.target.value })
              }
              className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {t('selectedIcon')}
          </label>
          <div
            className="h-9 rounded-lg border-2 flex items-center justify-center"
            style={{
              borderColor: formData.color,
              backgroundColor: formData.color + '15',
            }}
          >
            <div style={{ color: formData.color }}>
              {renderIcon(formData.icon, 20)}
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {t('selectIconLabel')} {!formData.icon && t('iconNotSelected')}
        </label>

        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            type="text"
            value={iconSearchQuery}
            onChange={(e) => setIconSearchQuery(e.target.value)}
            placeholder={t('searchIconPlaceholder')}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
          />
        </div>

        <div className="max-h-36 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
          {filteredIcons.length === 50 && debouncedIconSearchQuery && (
            <div className="p-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
              {t('iconLimitWarning')}
            </div>
          )}
          <div className="grid grid-cols-8 gap-1 p-2">
            <IconGrid
              icons={filteredIcons}
              selectedIcon={formData.icon}
              onIconSelect={(iconName) =>
                setFormData({ ...formData, icon: iconName })
              }
              renderIcon={renderIcon}
              accentClass="bg-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* モード選択 */}
      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {t('modeLabel')}
        </label>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
          {t('modeDescription')}
        </p>
        <div className="flex gap-1.5">
          {MODE_OPTIONS.map((opt) => {
            const ModeIcon = opt.icon;
            const isSelected = formData.mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFormData({ ...formData, mode: opt.value })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isSelected
                    ? 'text-white shadow-md'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700'
                }`}
                style={isSelected ? { backgroundColor: opt.color } : undefined}
              >
                <ModeIcon className="w-3.5 h-3.5" />
                {t(opt.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={cancelEdit}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-all font-medium"
        >
          <X className="w-3.5 h-3.5" />
          {tc('cancel')}
        </button>
        <button
          onClick={() =>
            isEdit && itemId ? handleUpdate(itemId) : handleAdd()
          }
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-sm text-white transition-all shadow-lg hover:shadow-xl font-medium"
        >
          <Save className="w-3.5 h-3.5" />
          {isEdit ? tc('save') : tc('create')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* ヘッダー */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <FolderKanban className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              {t('categoryList')}
            </h1>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              {t('categoryListDescription')}
            </p>
          </div>
          {!isAdding && (
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm text-white transition-all shadow-lg hover:shadow-xl font-medium"
            >
              <Plus className="w-4 h-4" />
              {t('newCategory')}
            </button>
          )}
        </div>

        {/* 新規追加フォーム */}
        {isAdding && (
          <div className="mb-4 rounded-xl border-2 border-indigo-500 bg-white dark:bg-indigo-dark-900 p-4 shadow-xl">
            <h2 className="mb-3 text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Plus className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              {t('newCategoryCreate')}
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
            <p className="text-lg font-medium mb-2">{t('noCategories')}</p>
            <p className="text-sm mb-4">{t('noCategoriesDescription')}</p>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="categories">
              {(provided) => (
                <div
                  className="grid gap-3"
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                >
                  {items
                    .filter(
                      (item) =>
                        !isAdding &&
                        (editingId === null || editingId === item.id),
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
                              snapshot.isDragging
                                ? 'shadow-2xl ring-2 ring-indigo-500/50'
                                : ''
                            }`}
                          >
                            {editingId === item.id ? (
                              <div className="p-4">
                                <h2 className="mb-3 text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                                  <Edit2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                                  {t('editCategory')}
                                </h2>
                                {renderForm(true, item.id)}
                              </div>
                            ) : (
                              <div className="p-4">
                                <div className="flex items-center justify-between gap-4">
                                  <div className="flex items-center gap-4 flex-1 min-w-0">
                                    <div
                                      {...provided.dragHandleProps}
                                      className="flex items-center justify-center w-6 shrink-0 cursor-grab active:cursor-grabbing text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                                      title={t('dragToReorder')}
                                    >
                                      <GripVertical className="w-5 h-5" />
                                    </div>
                                    <div
                                      className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0 shadow-sm"
                                      style={{
                                        backgroundColor: item.color + '20',
                                        color: item.color,
                                      }}
                                    >
                                      {renderIcon(item.icon, 20)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 truncate">
                                          {item.name}
                                        </h3>
                                        {defaultCategoryId === item.id && (
                                          <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                                            <Star className="w-3 h-3 fill-current" />
                                            <span className="hidden sm:inline">
                                              {t('default')}
                                            </span>
                                          </span>
                                        )}
                                        {(() => {
                                          const modeOpt = MODE_OPTIONS.find(
                                            (m) => m.value === item.mode,
                                          );
                                          if (!modeOpt) return null;
                                          const ModeIcon = modeOpt.icon;
                                          return (
                                            <span
                                              className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full"
                                              style={{
                                                backgroundColor:
                                                  modeOpt.color + '20',
                                                color: modeOpt.color,
                                              }}
                                            >
                                              <ModeIcon className="w-3 h-3" />
                                              {t(modeOpt.labelKey)}
                                            </span>
                                          );
                                        })()}
                                      </div>
                                      {item.description && (
                                        <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 line-clamp-1">
                                          {item.description}
                                        </p>
                                      )}
                                      <div className="flex items-center gap-2 mt-1.5">
                                        <span
                                          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded"
                                          style={{
                                            backgroundColor: item.color + '15',
                                            color: item.color,
                                          }}
                                        >
                                          <div
                                            className="w-2 h-2 rounded-full"
                                            style={{
                                              backgroundColor: item.color,
                                            }}
                                          />
                                          {item.color}
                                        </span>
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                                          <SwatchBook className="w-3 h-3" />
                                          <span className="font-semibold">
                                            {item._count?.themes ??
                                              item.themes?.length ??
                                              0}
                                          </span>
                                          <span className="hidden sm:inline">
                                            {t('themeName')}
                                          </span>
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      onClick={() =>
                                        setDefaultCategory(item.id)
                                      }
                                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-all font-medium ${
                                        defaultCategoryId === item.id
                                          ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-2 border-indigo-500'
                                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                                      }`}
                                      title={
                                        defaultCategoryId === item.id
                                          ? t('defaultCategoryLabel')
                                          : t('setDefaultCategoryLabel')
                                      }
                                    >
                                      <Star
                                        className={`w-3.5 h-3.5 ${defaultCategoryId === item.id ? 'fill-current' : ''}`}
                                      />
                                      <span className="hidden sm:inline">
                                        {defaultCategoryId === item.id
                                          ? t('default')
                                          : t('setAsDefault')}
                                      </span>
                                    </button>
                                    <button
                                      onClick={() => startEdit(item)}
                                      className="flex items-center gap-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 px-2.5 py-1.5 text-sm text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-all font-medium"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                      <span className="hidden sm:inline">
                                        {tc('edit')}
                                      </span>
                                    </button>
                                    {!item.isDefault && (
                                      <button
                                        onClick={() =>
                                          handleDelete(item.id, item.name)
                                        }
                                        className="flex items-center gap-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 px-2.5 py-1.5 text-sm text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-all font-medium"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span className="hidden sm:inline">
                                          {tc('delete')}
                                        </span>
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* 所属テーマ一覧 */}
                                {item.themes && item.themes.length > 0 && (
                                  <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {item.themes.slice(0, 5).map((theme) => {
                                        const ThemeIcon =
                                          getIconComponent(theme.icon || '') ||
                                          SwatchBook;
                                        return (
                                          <span
                                            key={theme.id}
                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
                                            style={{
                                              backgroundColor:
                                                theme.color + '15',
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
                                      {item.themes.length > 5 && (
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                          +{item.themes.length - 5}
                                        </span>
                                      )}
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
