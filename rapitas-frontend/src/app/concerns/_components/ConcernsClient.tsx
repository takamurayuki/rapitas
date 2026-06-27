'use client';

/**
 * ConcernsClient
 *
 * Orchestrator for the 懸念バックログ (Concern Backlog) page — a bug/refactor/risk
 * sibling of the idea box. Wires useConcerns to the header, add modal, filter
 * bar, list, and pagination. Holds no logic of its own.
 */

import Pagination from '@/components/ui/pagination/Pagination';
import { ConcernsHeader } from './concerns-header';
import { ConcernCreateForm } from './concern-create-form';
import { ConcernFilterBar } from './concern-filter-bar';
import { ConcernList } from './concern-list';
import { useConcerns } from './use-concerns';

export default function ConcernsClient() {
  const vm = useConcerns();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <ConcernsHeader onAddClick={vm.toggleAdd} />

      {/* Add form — modal so filing keeps you on the page (continuous adding) */}
      <ConcernCreateForm
        open={vm.showAdd}
        onClose={vm.closeAdd}
        titleRef={vm.titleRef}
        newTitle={vm.newTitle}
        setNewTitle={vm.setNewTitle}
        newDetail={vm.newDetail}
        setNewDetail={vm.setNewDetail}
        newType={vm.newType}
        setNewType={vm.setNewType}
        newSeverity={vm.newSeverity}
        setNewSeverity={vm.setNewSeverity}
        newLocation={vm.newLocation}
        setNewLocation={vm.setNewLocation}
        newCategoryId={vm.newCategoryId}
        onCategoryChange={vm.handleNewCategoryChange}
        newThemeId={vm.newThemeId}
        setNewThemeId={vm.setNewThemeId}
        categories={vm.categories}
        filteredThemes={vm.filteredThemes}
        onSubmit={vm.handleSubmit}
      />

      {/* Filters — status / type / severity / theme */}
      <ConcernFilterBar
        statusFilter={vm.statusFilter}
        setStatusFilter={vm.setStatusFilter}
        typeFilter={vm.typeFilter}
        setTypeFilter={vm.setTypeFilter}
        severityFilter={vm.severityFilter}
        setSeverityFilter={vm.setSeverityFilter}
        themeFilter={vm.themeFilter}
        setThemeFilter={vm.setThemeFilter}
        workingDirThemes={vm.workingDirThemes}
      />

      {/* List (loading / empty / populated). */}
      <ConcernList
        isLoading={vm.isLoading}
        concerns={vm.concerns}
        busyId={vm.busyId}
        canPublish={vm.canPublish}
        themeById={vm.themeById}
        onConvert={vm.handleConvert}
        onDelete={vm.handleDelete}
        onPublish={vm.handlePublish}
      />

      {!vm.isLoading && vm.totalPages >= 1 && (
        <Pagination
          currentPage={vm.currentPage}
          totalPages={vm.totalPages}
          itemsPerPage={vm.itemsPerPage}
          onPageChange={vm.setCurrentPage}
          onItemsPerPageChange={(n) => {
            vm.setItemsPerPage(n);
            vm.setCurrentPage(1);
          }}
        />
      )}
    </div>
  );
}
