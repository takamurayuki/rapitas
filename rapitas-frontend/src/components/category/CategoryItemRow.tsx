/**
 * CategoryItemRow
 *
 * Single draggable row in the CategoryManager list.
 * Renders both display mode and inline edit mode for a category item.
 */
'use client';
import { Edit2, Trash2, GripVertical, Star } from 'lucide-react';
import { Draggable } from '@hello-pangea/dnd';
import { useTranslations } from 'next-intl';
import { getIconComponent, ICON_DATA } from './IconData';
import { CategoryItemForm } from './CategoryItemForm';
import type { CategoryItem, CategoryManagerConfig } from './CategoryManager';
import type { CategoryFormData } from './useCategoryManager';

interface AccentClasses {
  ring: string;
  border: string;
  bg: string;
  bgLight: string;
  text: string;
  iconBg: string;
  dragRing: string;
}

interface CategoryItemRowProps {
  item: CategoryItem;
  index: number;
  config: CategoryManagerConfig;
  accent: AccentClasses;
  editingId: number | null;
  isAdding: boolean;
  formData: CategoryFormData;
  setFormData: (data: CategoryFormData) => void;
  iconSearchQuery: string;
  setIconSearchQuery: (q: string) => void;
  filteredIcons: string[];
  debouncedIconSearchQuery: string;
  onEdit: (item: CategoryItem) => void;
  onDelete: (id: number, name: string) => void;
  onSetDefault: (id: number) => void;
  onSave: (id?: number) => void;
  onCancel: () => void;
}

/**
 * Renders the appropriate icon for an item, falling back to the config default.
 *
 * @param iconName - Lucide icon key / アイコン名
 * @param defaultIconName - Fallback icon key / デフォルトアイコン名
 * @param size - Pixel size / ピクセルサイズ
 */
function ItemIcon({
  iconName,
  defaultIconName,
  size = 20,
}: {
  iconName: string | null | undefined;
  defaultIconName: string;
  size?: number;
}) {
  const IconComponent = getIconComponent(iconName || '');
  if (!IconComponent) {
    const DefaultIcon =
      getIconComponent(defaultIconName) || ICON_DATA['Tag'].component;
    return <DefaultIcon size={size} />;
  }
  return <IconComponent size={size} />;
}

/**
 * Draggable row representing a single category item, supporting inline editing and CRUD actions.
 *
 * @param props - Item data, edit state, accent styles, and action callbacks
 */
export function CategoryItemRow({
  item,
  index,
  config,
  accent,
  editingId,
  isAdding,
  formData,
  setFormData,
  iconSearchQuery,
  setIconSearchQuery,
  filteredIcons,
  debouncedIconSearchQuery,
  onEdit,
  onDelete,
  onSetDefault,
  onSave,
  onCancel,
}: CategoryItemRowProps) {
  const t = useTranslations('categories');
  const tc = useTranslations('common');

  return (
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
            snapshot.isDragging
              ? `shadow-2xl ring-2 ${accent.dragRing}`
              : ''
          }`}
        >
          {editingId === item.id ? (
            <div className="p-4">
              <h2 className="mb-3 text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                <Edit2 className={`w-4 h-4 ${accent.text}`} />
                {t('editItem', { item: config.itemName })}
              </h2>
              <CategoryItemForm
                config={config}
                accent={accent}
                formData={formData}
                setFormData={setFormData}
                iconSearchQuery={iconSearchQuery}
                setIconSearchQuery={setIconSearchQuery}
                filteredIcons={filteredIcons}
                debouncedIconSearchQuery={debouncedIconSearchQuery}
                isEdit={true}
                itemId={item.id}
                onSave={onSave}
                onCancel={onCancel}
              />
            </div>
          ) : (
            <div className="p-4 flex items-center justify-between gap-4">
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
                  <ItemIcon
                    iconName={item.icon}
                    defaultIconName={config.defaultIcon}
                    size={20}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 truncate">
                    {item.name}
                  </h3>
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
                        style={{ backgroundColor: item.color }}
                      />
                      {item.color}
                    </span>
                    {item._count && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                        <span className="font-semibold">
                          {item._count.tasks}
                        </span>
                        <span className="hidden sm:inline">{t('tasks')}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {config.showDefaultButton && (
                  <button
                    onClick={() => onSetDefault(item.id)}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-all font-medium ${
                      item.isDefault
                        ? `${accent.bgLight} ${accent.text} border-2 ${accent.border}`
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${item.isDefault ? 'fill-current' : ''}`}
                    />
                    <span className="hidden sm:inline">
                      {item.isDefault ? t('default') : t('setAsDefault')}
                    </span>
                  </button>
                )}
                <button
                  onClick={() => onEdit(item)}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 px-2.5 py-1.5 text-sm text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-all font-medium"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{tc('edit')}</span>
                </button>
                <button
                  onClick={() => onDelete(item.id, item.name)}
                  className="flex items-center gap-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 px-2.5 py-1.5 text-sm text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-all font-medium"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{tc('delete')}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}
