'use client';
// category-item

import { Pencil, Trash2, Star, SwatchBook, GripVertical } from 'lucide-react';
import { type DraggableProvided } from '@hello-pangea/dnd';
import { useTranslations } from 'next-intl';
import { getIconComponent } from '@/components/category/icon-data';
import { renderIcon } from './category-form';
import type { CategoryWithThemes } from '../hooks/useCategories';

/** Props for CategoryItem. */
interface CategoryItemProps {
  /** The category data to display / 表示するカテゴリデータ */
  item: CategoryWithThemes;
  /** Whether this category is the app-wide default / デフォルトカテゴリかどうか */
  isDefault: boolean;
  /** react-beautiful-dnd provided object for drag-and-drop / DnD用providedオブジェクト */
  dragProvided: DraggableProvided;
  /** Called to start editing this item / 編集開始コールバック */
  onEdit: (item: CategoryWithThemes) => void;
  /** Called to delete this item by ID and name / 削除コールバック */
  onDelete: (id: number, name: string) => void;
  /** Called to set this item as the default category / デフォルト設定コールバック */
  onSetDefault: (id: number) => void;
}

/**
 * Read-only view of a single category row with drag handle and action buttons.
 */
export function CategoryItem({
  item,
  isDefault,
  dragProvided,
  onEdit,
  onDelete,
  onSetDefault,
}: CategoryItemProps) {
  const t = useTranslations('categories');
  const tc = useTranslations('common');

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Drag handle */}
        <div
          {...dragProvided.dragHandleProps}
          className="shrink-0 cursor-grab active:cursor-grabbing text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 transition-colors"
          title={t('dragToReorder')}
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Icon swatch */}
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: item.color + '20', color: item.color }}
        >
          {renderIcon(item.icon, 20)}
        </div>

        {/* Text content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
              {item.name}
            </h3>
            {isDefault && (
              <Star className="w-3.5 h-3.5 shrink-0 fill-current" style={{ color: item.color }} />
            )}
          </div>

          {item.description && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-1">
              {item.description}
            </p>
          )}

          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
              <SwatchBook className="w-3 h-3" />
              {item._count?.themes ?? item.themes?.length ?? 0} {t('themeName')}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onSetDefault(item.id)}
            className={`p-2 rounded-lg transition-colors ${
              isDefault
                ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                : 'text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
            }`}
            title={isDefault ? t('defaultCategoryLabel') : t('setDefaultCategoryLabel')}
          >
            <Star className={`w-4 h-4 ${isDefault ? 'fill-current' : ''}`} />
          </button>
          <button
            onClick={() => onEdit(item)}
            className="p-2 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
            title={tc('edit')}
          >
            <Pencil className="w-4 h-4" />
          </button>
          {!item.isDefault && (
            <button
              onClick={() => onDelete(item.id, item.name)}
              className="p-2 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              title={tc('delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Theme chips */}
      {item.themes && item.themes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 pl-7">
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.themes.slice(0, 5).map((theme) => {
              const ThemeIcon = getIconComponent(theme.icon || '') || SwatchBook;
              return (
                <span
                  key={theme.id}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
                  style={{ backgroundColor: theme.color + '15', color: theme.color }}
                >
                  <ThemeIcon className="w-3 h-3" />
                  {theme.name}
                  {theme._count && <span className="opacity-60">({theme._count.tasks})</span>}
                </span>
              );
            })}
            {item.themes.length > 5 && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                +{item.themes.length - 5}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
