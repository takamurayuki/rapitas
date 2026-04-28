'use client';
// CategoryManager
import { Plus, type LucideIcon } from 'lucide-react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { ListSkeleton } from '@/components/ui/LoadingSpinner';
import { ICON_DATA, ICON_NAMES } from './icon-data';
import { useTranslations } from 'next-intl';
import { useCategoryManager } from './useCategoryManager';
import { CategoryItemForm } from './CategoryItemForm';
import { CategoryItemRow } from './CategoryItemRow';

// Export ICON_MAP for backward compatibility
export const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  ICON_NAMES.map((name) => [name, ICON_DATA[name].component]),
);

/** Common shape for any category or label item returned by the API. */
export type CategoryItem = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  isDefault?: boolean;
  _count?: { tasks: number };
};

/** Configuration that makes CategoryManager reusable for both themes and labels. */
export type CategoryManagerConfig = {
  title: string;
  titleIcon: LucideIcon;
  /** Singular display name used in toast messages, e.g. "Theme" or "Label". */
  itemName: string;
  endpoint: string;
  /** Tailwind accent color key: "purple" or "indigo". */
  accentColor: string;
  defaultColor: string;
  defaultIcon: string;
  showDefaultButton?: boolean;
};

type Props = {
  config: CategoryManagerConfig;
};

const accentClasses = {
  purple: {
    ring: 'focus:ring-purple-500',
    border: 'border-purple-500',
    bg: 'bg-purple-600 hover:bg-purple-700',
    bgLight: 'bg-purple-100 dark:bg-purple-900/30',
    text: 'text-purple-600 dark:text-purple-400',
    iconBg: 'bg-purple-500',
    dragRing: 'ring-purple-500/50',
  },
  indigo: {
    ring: 'focus:ring-indigo-500',
    border: 'border-indigo-500',
    bg: 'bg-indigo-600 hover:bg-indigo-700',
    bgLight: 'bg-indigo-100 dark:bg-indigo-900/30',
    text: 'text-indigo-600 dark:text-indigo-400',
    iconBg: 'bg-indigo-500',
    dragRing: 'ring-indigo-500/50',
  },
};

/**
 * Full-page category/label manager with CRUD, drag-and-drop reorder, and icon search.
 *
 * @param config - Display and API configuration for the specific item type
 */
export default function CategoryManager({ config }: Props) {
  const t = useTranslations('categories');

  const accent =
    accentClasses[config.accentColor as keyof typeof accentClasses] || accentClasses.indigo;

  const {
    items,
    loading,
    editingId,
    isAdding,
    setIsAdding,
    iconSearchQuery,
    setIconSearchQuery,
    formData,
    setFormData,
    filteredIcons,
    debouncedIconSearchQuery,
    handleAdd,
    handleUpdate,
    handleDelete,
    setDefault,
    startEdit,
    cancelEdit,
    handleDragEnd,
  } = useCategoryManager(config);

  const TitleIcon = config.titleIcon;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <TitleIcon className={`w-6 h-6 ${accent.text}`} />
              {config.title}
            </h1>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              {t('manageItems', { item: config.itemName })}
            </p>
          </div>
          {!isAdding && (
            <button
              onClick={() => setIsAdding(true)}
              className={`flex items-center gap-1.5 rounded-lg ${accent.bg} px-4 py-2 text-sm text-white transition-all shadow-lg hover:shadow-xl font-medium`}
            >
              <Plus className="w-4 h-4" />
              {t('newItem', { item: config.itemName })}
            </button>
          )}
        </div>

        {/* New item form */}
        {isAdding && (
          <div
            className={`mb-4 rounded-xl border-2 ${accent.border} bg-white dark:bg-zinc-900 p-4 shadow-xl`}
          >
            <h2 className="mb-3 text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Plus className={`w-4 h-4 ${accent.text}`} />
              {t('newItemCreate', { item: config.itemName })}
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
              isEdit={false}
              onSave={() => handleAdd()}
              onCancel={cancelEdit}
            />
          </div>
        )}

        {/* List */}
        {loading ? (
          <ListSkeleton count={4} />
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <TitleIcon className="w-16 h-16 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
            <p className="text-lg font-medium mb-2">{t('itemNone', { item: config.itemName })}</p>
            <p className="text-sm mb-4">{t('itemCreateFirst', { item: config.itemName })}</p>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId={config.endpoint}>
              {(provided) => (
                <div className="grid gap-3" ref={provided.innerRef} {...provided.droppableProps}>
                  {items
                    .filter((item) => {
                      if (isAdding) return false;
                      if (editingId !== null) return item.id === editingId;
                      return true;
                    })
                    .map((item, index) => (
                      <CategoryItemRow
                        key={item.id}
                        item={item}
                        index={index}
                        config={config}
                        accent={accent}
                        editingId={editingId}
                        isAdding={isAdding}
                        formData={formData}
                        setFormData={setFormData}
                        iconSearchQuery={iconSearchQuery}
                        setIconSearchQuery={setIconSearchQuery}
                        filteredIcons={filteredIcons}
                        debouncedIconSearchQuery={debouncedIconSearchQuery}
                        onEdit={startEdit}
                        onDelete={handleDelete}
                        onSetDefault={setDefault}
                        onSave={(id) => (id !== undefined ? handleUpdate(id) : handleAdd())}
                        onCancel={cancelEdit}
                      />
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
