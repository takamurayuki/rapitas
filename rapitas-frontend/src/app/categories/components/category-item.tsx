'use client';
// category-item

import { Edit2, Trash2, Star, SwatchBook, GripVertical } from 'lucide-react';
import { type DraggableProvided } from '@hello-pangea/dnd';
import { useTranslations } from 'next-intl';
import { getIconComponent } from '@/components/category/icon-data';
import { renderIcon, MODE_OPTIONS } from './category-form';
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
  const modeOpt = MODE_OPTIONS.find((m) => m.value === item.mode);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {/* Drag handle */}
          <div
            {...dragProvided.dragHandleProps}
            className="flex items-center justify-center w-6 shrink-0 cursor-grab active:cursor-grabbing text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            title={t('dragToReorder')}
          >
            <GripVertical className="w-5 h-5" />
          </div>

          {/* Category icon */}
          <div
            className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0 shadow-sm"
            style={{ backgroundColor: item.color + '20', color: item.color }}
          >
            {renderIcon(item.icon, 20)}
          </div>

          {/* Name, badges, and meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 truncate">
                {item.name}
              </h3>
              {isDefault && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                  <Star className="w-3 h-3 fill-current" />
                  <span className="hidden sm:inline">{t('default')}</span>
                </span>
              )}
              {modeOpt &&
                (() => {
                  const ModeIcon = modeOpt.icon;
                  return (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: modeOpt.color + '20',
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
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.color}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                <SwatchBook className="w-3 h-3" />
                <span className="font-semibold">
                  {item._count?.themes ?? item.themes?.length ?? 0}
                </span>
                <span className="hidden sm:inline">{t('themeName')}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onSetDefault(item.id)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-all font-medium ${
              isDefault
                ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-2 border-indigo-500'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
            title={isDefault ? t('defaultCategoryLabel') : t('setDefaultCategoryLabel')}
          >
            <Star className={`w-3.5 h-3.5 ${isDefault ? 'fill-current' : ''}`} />
            <span className="hidden sm:inline">{isDefault ? t('default') : t('setAsDefault')}</span>
          </button>

          <button
            onClick={() => onEdit(item)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 px-2.5 py-1.5 text-sm text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-all font-medium"
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{tc('edit')}</span>
          </button>

          {!item.isDefault && (
            <button
              onClick={() => onDelete(item.id, item.name)}
              className="flex items-center gap-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 px-2.5 py-1.5 text-sm text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-all font-medium"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{tc('delete')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Theme chips */}
      {item.themes && item.themes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.themes.slice(0, 5).map((theme) => {
              const ThemeIcon = getIconComponent(theme.icon || '') || SwatchBook;
              return (
                <span
                  key={theme.id}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
                  style={{
                    backgroundColor: theme.color + '15',
                    color: theme.color,
                  }}
                >
                  <ThemeIcon className="w-3 h-3" />
                  {theme.name}
                  {theme._count && <span className="opacity-60">({theme._count.tasks})</span>}
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
  );
}
