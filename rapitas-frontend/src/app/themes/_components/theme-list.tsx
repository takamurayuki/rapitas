/**
 * ThemeList
 *
 * Renders the drag-and-drop list of themes for the currently selected category.
 * Handles the empty-state view and delegates card rendering to ThemeCard.
 */
import { Edit2, SwatchBook } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import type { Theme } from '@/types';
import { ThemeCard } from './theme-card';
import { ThemeForm } from './theme-form';
import type { FormData } from '../_hooks/useThemesPage';
import type { Category } from '@/types';

type DirStatus = {
  checking: boolean;
  exists: boolean | null;
  isGitRepo: boolean;
};

type Props = {
  items: Theme[];
  selectedCategoryId: number | null;
  categories: Category[];
  editingId: number | null;
  // Form props (forwarded to ThemeForm when a row is being edited)
  formData: FormData;
  setFormData: (data: FormData) => void;
  iconSearchQuery: string;
  setIconSearchQuery: (q: string) => void;
  filteredIcons: string[];
  debouncedIconSearchQuery: string;
  dirStatus: DirStatus;
  newFolderName: string;
  setNewFolderName: (name: string) => void;
  isCreatingDir: boolean;
  showCreateFolder: boolean;
  branches: string[];
  loadingBranches: boolean;
  branchError: string | null;
  setBranches: (b: string[]) => void;
  setBranchError: (e: string | null) => void;
  renderIcon: (iconName: string | null | undefined, size?: number) => React.ReactNode;
  onDragEnd: (result: DropResult) => void;
  onEdit: (item: Theme) => void;
  onDelete: (id: number, name: string) => void;
  onSetDefault: (id: number) => void;
  onSave: (itemId?: number) => void;
  onCancel: () => void;
  onCheckDirectory: (path: string) => void;
  onFetchBranches: (repoUrl: string) => void;
  onCreateDirectory: () => void;
  onCreateNewFolder: () => void;
};

/**
 * Drag-and-drop sortable list of themes with inline editing support.
 *
 * @param props.items - All themes (will be filtered/sorted internally by selectedCategoryId).
 * @param props.selectedCategoryId - Filters to only themes in this category.
 * @param props.editingId - Id of the theme currently open in the inline edit form.
 * @param props.onDragEnd - Called by DragDropContext when a drag completes.
 */
export function ThemeList({
  items,
  selectedCategoryId,
  categories,
  editingId,
  formData,
  setFormData,
  iconSearchQuery,
  setIconSearchQuery,
  filteredIcons,
  debouncedIconSearchQuery,
  dirStatus,
  newFolderName,
  setNewFolderName,
  isCreatingDir,
  showCreateFolder,
  branches,
  loadingBranches,
  branchError,
  setBranches,
  setBranchError,
  renderIcon,
  onDragEnd,
  onEdit,
  onDelete,
  onSetDefault,
  onSave,
  onCancel,
  onCheckDirectory,
  onFetchBranches,
  onCreateDirectory,
  onCreateNewFolder,
}: Props) {
  const t = useTranslations('themes');

  const filteredItems =
    selectedCategoryId === null
      ? items
      : items.filter((item) => item.categoryId === selectedCategoryId);

  const sortedItems = [...filteredItems].sort((a, b) => a.sortOrder - b.sortOrder);

  const currentCategoryId = selectedCategoryId ?? (categories.length > 0 ? categories[0].id : null);

  if (sortedItems.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500 dark:text-zinc-400 bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <SwatchBook className="w-16 h-16 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
        <p className="text-lg font-medium mb-2">{t('noCategoryThemes')}</p>
        <p className="text-sm mb-4">{t('noCategoryThemesDescription')}</p>
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId={`themes-category-${currentCategoryId}`}>
        {(provided) => (
          <div className="grid gap-3" ref={provided.innerRef} {...provided.droppableProps}>
            {sortedItems.map((item, index) => (
              <Draggable
                key={item.id}
                draggableId={String(item.id)}
                index={index}
                isDragDisabled={editingId !== null}
              >
                {(draggableProvided, snapshot) => (
                  <div
                    ref={draggableProvided.innerRef}
                    {...draggableProvided.draggableProps}
                    className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-indigo-dark-900 hover:shadow-lg transition-all overflow-hidden ${
                      snapshot.isDragging ? 'shadow-2xl ring-2 ring-purple-500/50' : ''
                    }`}
                  >
                    {editingId === item.id ? (
                      <div className="p-4">
                        <h2 className="mb-3 text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                          <Edit2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                          {t('editTheme')}
                        </h2>
                        <ThemeForm
                          isEdit
                          itemId={item.id}
                          formData={formData}
                          setFormData={setFormData}
                          categories={categories}
                          selectedCategoryId={selectedCategoryId}
                          iconSearchQuery={iconSearchQuery}
                          setIconSearchQuery={setIconSearchQuery}
                          filteredIcons={filteredIcons}
                          debouncedIconSearchQuery={debouncedIconSearchQuery}
                          dirStatus={dirStatus}
                          newFolderName={newFolderName}
                          setNewFolderName={setNewFolderName}
                          isCreatingDir={isCreatingDir}
                          showCreateFolder={showCreateFolder}
                          branches={branches}
                          loadingBranches={loadingBranches}
                          branchError={branchError}
                          setBranches={setBranches}
                          setBranchError={setBranchError}
                          editingId={editingId}
                          renderIcon={renderIcon}
                          onSave={onSave}
                          onCancel={onCancel}
                          onCheckDirectory={onCheckDirectory}
                          onFetchBranches={onFetchBranches}
                          onCreateDirectory={onCreateDirectory}
                          onCreateNewFolder={onCreateNewFolder}
                        />
                      </div>
                    ) : (
                      <ThemeCard
                        item={item}
                        provided={draggableProvided}
                        renderIcon={renderIcon}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        onSetDefault={onSetDefault}
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
  );
}
