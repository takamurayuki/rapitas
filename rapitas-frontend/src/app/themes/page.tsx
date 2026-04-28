'use client';
// ThemesPage
import { Plus, SwatchBook } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ListSkeleton } from '@/components/ui/LoadingSpinner';
import { useThemesPage, defaultFormData } from './_hooks/useThemesPage';
import { CategoryTabs } from './_components/category-tabs';
import { ThemeForm } from './_components/theme-form';
import { ThemeList } from './_components/theme-list';

export default function ThemesPage() {
  const t = useTranslations('themes');
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
    dirStatus,
    newFolderName,
    setNewFolderName,
    isCreatingDir,
    showCreateFolder,
    categories,
    selectedCategoryId,
    setSelectedCategoryId,
    branches,
    loadingBranches,
    branchError,
    setBranches,
    setBranchError,
    filteredIcons,
    debouncedIconSearchQuery,
    fetchBranches,
    checkDirectory,
    handleCreateDirectory,
    handleCreateNewFolder,
    handleAdd,
    handleUpdate,
    handleDelete,
    setDefault,
    startEdit,
    cancelEdit,
    handleDragEnd,
    renderIcon,
  } = useThemesPage();

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Page header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <SwatchBook className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              {t('title')}
            </h1>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{t('subtitle')}</p>
          </div>
          {!isAdding && (
            <button
              onClick={() => {
                setFormData({
                  ...defaultFormData,
                  categoryId:
                    selectedCategoryId ?? (categories.length > 0 ? categories[0].id : null),
                });
                setIsAdding(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 px-4 py-2 text-sm text-white transition-all shadow-lg hover:shadow-xl font-medium"
            >
              <Plus className="w-4 h-4" />
              {t('newTheme')}
            </button>
          )}
        </div>

        {/* Category filter tabs */}
        <CategoryTabs
          categories={categories}
          items={items}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={(id) => {
            setSelectedCategoryId(id);
            cancelEdit();
          }}
          renderIcon={renderIcon}
        />

        {/* Add form */}
        {isAdding && (
          <div className="mb-4 rounded-xl border-2 border-purple-500 bg-white dark:bg-indigo-dark-900 p-4 shadow-xl">
            <ThemeForm
              isEdit={false}
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
              onSave={() => handleAdd()}
              onCancel={cancelEdit}
              onCheckDirectory={checkDirectory}
              onFetchBranches={fetchBranches}
              onCreateDirectory={handleCreateDirectory}
              onCreateNewFolder={handleCreateNewFolder}
            />
          </div>
        )}

        {/* Theme list or skeleton */}
        {!isAdding &&
          (loading ? (
            <ListSkeleton count={3} showTabs showBadges />
          ) : (
            <ThemeList
              items={items}
              selectedCategoryId={selectedCategoryId}
              categories={categories}
              editingId={editingId}
              formData={formData}
              setFormData={setFormData}
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
              renderIcon={renderIcon}
              onDragEnd={handleDragEnd}
              onEdit={startEdit}
              onDelete={handleDelete}
              onSetDefault={setDefault}
              onSave={(itemId) => (itemId !== undefined ? handleUpdate(itemId) : handleAdd())}
              onCancel={cancelEdit}
              onCheckDirectory={checkDirectory}
              onFetchBranches={fetchBranches}
              onCreateDirectory={handleCreateDirectory}
              onCreateNewFolder={handleCreateNewFolder}
            />
          ))}
      </div>
    </div>
  );
}
