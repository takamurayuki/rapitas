/**
 * IdeasClient
 *
 * Orchestrator for the IdeaBox page: wires useIdeaBox to the header, filter bar,
 * list, add/edit modal, pagination, and theme-picker modal. Holds no logic.
 */
'use client';
import Pagination from '@/components/ui/pagination/Pagination';
import { IdeaBoxHeader } from './IdeaBoxHeader';
import { IdeaCreateForm } from './idea-create-form';
import { IdeaFilterBar } from './idea-filter-bar';
import { IdeaList } from './idea-list';
import { ThemePickerModal } from './theme-picker-modal';
import { useIdeaBox } from './use-idea-box';

export default function IdeasClient() {
  const vm = useIdeaBox();

  return (
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background">
      <div className="mx-auto max-w-4xl px-3 sm:px-4 md:px-6 py-4">
        <IdeaBoxHeader totalIdeas={vm.displayTotalIdeas} onAddClick={vm.handleAddClick} />

        {/* Quick Add — modal so adding keeps you on the page (continuous adding) */}
        <IdeaCreateForm
          showQuickAdd={vm.showQuickAdd}
          editingId={vm.editingId}
          newTitle={vm.newTitle}
          setNewTitle={vm.setNewTitle}
          newContent={vm.newContent}
          setNewContent={vm.setNewContent}
          newPriority={vm.newPriority}
          setNewPriority={vm.setNewPriority}
          newThemeId={vm.newThemeId}
          setNewThemeId={vm.setNewThemeId}
          isSubmitting={vm.isSubmitting}
          flashKey={vm.flashKey}
          filteredThemes={vm.filteredThemes}
          titleRef={vm.titleRef}
          contentTextareaRef={vm.contentTextareaRef}
          onSubmit={vm.handleSubmit}
          onCancel={vm.handleCancel}
          onSaveAndConvert={vm.handleSaveAndConvert}
        />

        {/* Filters — status / priority / category / theme */}
        <IdeaFilterBar
          statusFilter={vm.statusFilter}
          setStatusFilter={vm.setStatusFilter}
          priorityFilter={vm.priorityFilter}
          setPriorityFilter={vm.setPriorityFilter}
          filterThemeId={vm.filterThemeId}
          setFilterThemeId={vm.setFilterThemeId}
          filterThemes={vm.filterThemes}
          searchQuery={vm.searchQuery}
        />

        {/* Idea list (loading / empty / populated). */}
        <IdeaList
          isLoading={vm.isLoading}
          filtered={vm.filtered}
          paginatedFiltered={vm.paginatedFiltered}
          searchQuery={vm.searchQuery}
          themes={vm.themes}
          isConverting={vm.isConverting}
          convertingIdeaId={vm.convertingIdeaId}
          onConvert={vm.handleConvertToTask}
          onEdit={vm.handleEdit}
          onDelete={vm.handleDelete}
        />

        {/* Pagination - 検索時も表示 */}
        {!vm.isLoading && vm.filtered.length > 0 && (
          <Pagination
            currentPage={vm.currentPage}
            totalPages={vm.dynamicTotalPages}
            itemsPerPage={vm.itemsPerPage}
            onPageChange={vm.handlePageChange}
            onItemsPerPageChange={vm.handleItemsPerPageChange}
            alwaysShow
          />
        )}
      </div>

      {/* テーマ選択モーダル — テーマ未設定アイデアのタスク化前に表示（ワークフロー登録にテーマ必須） */}
      {vm.themePickerIdea && (
        <ThemePickerModal
          idea={vm.themePickerIdea}
          themePickerThemes={vm.themePickerThemes}
          themePickerThemeId={vm.themePickerThemeId}
          setThemePickerThemeId={vm.setThemePickerThemeId}
          onClose={vm.closeThemePicker}
          onSubmit={vm.submitThemePicker}
        />
      )}
    </div>
  );
}
