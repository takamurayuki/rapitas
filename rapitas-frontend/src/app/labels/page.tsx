'use client';
// LabelsPage — Category → Labels (per-category scoping, 2026-07 migration)
import { Plus, Tags } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ListSkeleton } from '@/components/ui/LoadingSpinner';
import { useLabelsPage, defaultFormData } from './_hooks/useLabelsPage';
import { CategoryTabs } from './_components/category-tabs';
import { LabelList } from './_components/label-list';
import { LabelForm } from './_components/label-form';

export default function LabelsPage() {
  const t = useTranslations('labels');
  const {
    labels,
    categories,
    filteredLabels,
    loading,
    selectedCategoryId,
    editingId,
    isAdding,
    setIsAdding,
    formData,
    setFormData,
    iconSearchQuery,
    setIconSearchQuery,
    filteredIcons,
    debouncedIconSearchQuery,
    renderIcon,
    handleAdd,
    handleUpdate,
    handleDelete,
    startEdit,
    cancelEdit,
    selectCategory,
  } = useLabelsPage();

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Page header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Tags className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              {t('pageTitle')}
            </h1>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{t('pageSubtitle')}</p>
          </div>
          {!isAdding && (
            <button
              onClick={() => {
                setFormData({ ...defaultFormData, categoryId: selectedCategoryId });
                setIsAdding(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm text-white transition-all shadow-lg hover:shadow-xl font-medium"
            >
              <Plus className="w-4 h-4" />
              {t('addButton')}
            </button>
          )}
        </div>

        {/* Category tabs — labels are scoped per category */}
        <CategoryTabs
          categories={categories}
          labels={labels}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={selectCategory}
          renderIcon={renderIcon}
        />

        {/* Add form */}
        {isAdding && (
          <div className="mb-4 rounded-xl border-2 border-indigo-500 bg-white dark:bg-indigo-dark-900 p-4">
            <LabelForm
              formData={formData}
              setFormData={setFormData}
              iconSearchQuery={iconSearchQuery}
              setIconSearchQuery={setIconSearchQuery}
              filteredIcons={filteredIcons}
              debouncedIconSearchQuery={debouncedIconSearchQuery}
              renderIcon={renderIcon}
              onSave={handleAdd}
              onCancel={cancelEdit}
            />
          </div>
        )}

        {/* Label list / skeleton */}
        {!isAdding &&
          (loading ? (
            <ListSkeleton count={4} />
          ) : (
            <LabelList
              labels={filteredLabels}
              editingId={editingId}
              formData={formData}
              setFormData={setFormData}
              iconSearchQuery={iconSearchQuery}
              setIconSearchQuery={setIconSearchQuery}
              filteredIcons={filteredIcons}
              debouncedIconSearchQuery={debouncedIconSearchQuery}
              renderIcon={renderIcon}
              onEdit={startEdit}
              onDelete={handleDelete}
              onSave={handleUpdate}
              onCancel={cancelEdit}
            />
          ))}
      </div>
    </div>
  );
}
