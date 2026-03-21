/**
 * CategoriesPage
 *
 * Page component for managing categories: listing, creating, editing, deleting,
 * and drag-and-drop reordering. Delegates data logic to useCategories and
 * rendering of individual rows to CategoryItem and CategoryForm.
 */

'use client';

import { Plus, Edit2, FolderKanban } from 'lucide-react';
import {
  DragDropContext,
  Droppable,
  Draggable,
} from '@hello-pangea/dnd';
import { useTranslations } from 'next-intl';
import { ListSkeleton } from '@/components/ui/LoadingSpinner';
import { useCategories } from './hooks/useCategories';
import { CategoryForm } from './components/category-form';
import { CategoryItem } from './components/category-item';

/**
 * Categories management page.
 * Renders a list of draggable category rows with inline add/edit forms.
 */
export default function CategoriesPage() {
  const t = useTranslations('categories');

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
    defaultCategoryId,
    filteredIcons,
    debouncedIconSearchQuery,
    handleAdd,
    handleUpdate,
    handleDelete,
    setDefaultCategory,
    startEdit,
    cancelEdit,
    handleDragEnd,
  } = useCategories();

  const formProps = {
    formData,
    setFormData,
    iconSearchQuery,
    setIconSearchQuery,
    filteredIcons,
    debouncedIconSearchQuery,
    onCancel: cancelEdit,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Page header */}
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

        {/* Add new category form */}
        {isAdding && (
          <div className="mb-4 rounded-xl border-2 border-indigo-500 bg-white dark:bg-indigo-dark-900 p-4 shadow-xl">
            <h2 className="mb-3 text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Plus className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              {t('newCategoryCreate')}
            </h2>
            <CategoryForm
              {...formProps}
              isEdit={false}
              onSubmit={() => handleAdd()}
            />
          </div>
        )}

        {/* Category list */}
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
                                <CategoryForm
                                  {...formProps}
                                  isEdit={true}
                                  itemId={item.id}
                                  onSubmit={(id) => id && handleUpdate(id)}
                                />
                              </div>
                            ) : (
                              <CategoryItem
                                item={item}
                                isDefault={defaultCategoryId === item.id}
                                dragProvided={provided}
                                onEdit={startEdit}
                                onDelete={handleDelete}
                                onSetDefault={setDefaultCategory}
                              />
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
