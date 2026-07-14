'use client';

/**
 * SubtaskSection
 *
 * Orchestrates the subtask card: header, delete confirmation, add form, and item list.
 * All state is owned by the parent and threaded in as props.
 */

import { useState } from 'react';
import type { Task, Priority } from '@/types';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/status/SubtaskExecutionStatus';
import { SubtaskHeader } from './subtask-section/SubtaskHeader';
import { SubtaskDeleteConfirm } from './subtask-section/SubtaskDeleteConfirm';
import { AddSubtaskForm } from './subtask-section/AddSubtaskForm';
import { SubtaskItem } from './subtask-section/SubtaskItem';

interface SubtaskSectionProps {
  subtasks: NonNullable<Task['subtasks']>;
  /** Parent task's theme name — note-link hierarchy metadata for subtasks. */
  themeName?: string;
  /** Parent task's category name — note-link hierarchy metadata for subtasks. */
  categoryName?: string;
  isSubtaskSelectionMode: boolean;
  selectedSubtaskIds: Set<number>;
  showSubtaskDeleteConfirm: 'all' | 'selected' | null;
  editingSubtaskId: number | null;
  editingSubtaskTitle: string;
  editingSubtaskDescription: string;
  editingSubtaskPriority: Priority;
  editingSubtaskEstimatedHours: string;
  editingSubtaskActualHours: string;
  isParallelExecutionRunning: boolean;
  getSubtaskStatus: (subtaskId: number) => ParallelExecutionStatus | undefined;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onToggleSubtaskSelection: (id: number) => void;
  onSetDeleteConfirm: (v: 'all' | 'selected' | null) => void;
  onDeleteAll: () => void;
  onDeleteSelected: () => void;
  onBulkUpdateStatus: (status: string) => void;
  onStartEditingSubtask: (subtask: NonNullable<Task['subtasks']>[number]) => void;
  onSetEditingSubtaskTitle: (v: string) => void;
  onSetEditingSubtaskDescription: (v: string) => void;
  onSetEditingSubtaskPriority: (v: Priority) => void;
  onSetEditingSubtaskEstimatedHours: (v: string) => void;
  onSetEditingSubtaskActualHours: (v: string) => void;
  onSaveSubtaskEdit: () => void;
  onCancelEditingSubtask: () => void;
  onUpdateStatus: (id: number, status: string) => void;
  newSubtaskTitle: string;
  newSubtaskDescription: string;
  newSubtaskPriority: Priority;
  newSubtaskEstimatedHours: string;
  newSubtaskActualHours: string;
  onSetNewSubtaskTitle: (v: string) => void;
  onSetNewSubtaskDescription: (v: string) => void;
  onSetNewSubtaskPriority: (v: Priority) => void;
  onSetNewSubtaskEstimatedHours: (v: string) => void;
  onSetNewSubtaskActualHours: (v: string) => void;
  onAddSubtask: () => void;
}

export default function SubtaskSection({
  subtasks,
  themeName,
  categoryName,
  isSubtaskSelectionMode,
  selectedSubtaskIds,
  showSubtaskDeleteConfirm,
  editingSubtaskId,
  editingSubtaskTitle,
  editingSubtaskDescription,
  editingSubtaskPriority,
  editingSubtaskEstimatedHours,
  editingSubtaskActualHours,
  isParallelExecutionRunning,
  getSubtaskStatus,
  onToggleSelectionMode,
  onSelectAll,
  onDeselectAll,
  onToggleSubtaskSelection,
  onSetDeleteConfirm,
  onDeleteAll,
  onDeleteSelected,
  onBulkUpdateStatus,
  onStartEditingSubtask,
  onSetEditingSubtaskTitle,
  onSetEditingSubtaskDescription,
  onSetEditingSubtaskPriority,
  onSetEditingSubtaskEstimatedHours,
  onSetEditingSubtaskActualHours,
  onSaveSubtaskEdit,
  onCancelEditingSubtask,
  onUpdateStatus,
  newSubtaskTitle,
  newSubtaskDescription,
  newSubtaskPriority,
  newSubtaskEstimatedHours,
  newSubtaskActualHours,
  onSetNewSubtaskTitle,
  onSetNewSubtaskDescription,
  onSetNewSubtaskPriority,
  onSetNewSubtaskEstimatedHours,
  onSetNewSubtaskActualHours,
  onAddSubtask,
}: SubtaskSectionProps) {
  // While a subtask is being edited, collapse the card to just that item so the
  // edit form is the only thing on screen (other rows and the add form hide).
  const isEditingAny = editingSubtaskId !== null;

  // User-controlled visibility of the add form (header toggle) — purely a
  // view preference, so it lives here rather than in the parent hooks.
  const [isAddFormVisible, setIsAddFormVisible] = useState(true);
  const visibleSubtasks = isEditingAny
    ? subtasks.filter((s) => s.id === editingSubtaskId)
    : subtasks;

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden mb-6">
      <SubtaskHeader
        subtasks={subtasks}
        isSubtaskSelectionMode={isSubtaskSelectionMode}
        selectedSubtaskIds={selectedSubtaskIds}
        onToggleSelectionMode={onToggleSelectionMode}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        onSetDeleteConfirm={onSetDeleteConfirm}
        onBulkUpdateStatus={onBulkUpdateStatus}
        isAddFormVisible={isAddFormVisible}
        onToggleAddForm={() => setIsAddFormVisible((v) => !v)}
      />

      {showSubtaskDeleteConfirm && (
        <SubtaskDeleteConfirm
          mode={showSubtaskDeleteConfirm}
          totalCount={subtasks.length}
          selectedCount={selectedSubtaskIds.size}
          onConfirm={showSubtaskDeleteConfirm === 'all' ? onDeleteAll : onDeleteSelected}
          onCancel={() => onSetDeleteConfirm(null)}
        />
      )}

      {/* border-b closes the last row with a line even when nothing renders
          below (selection mode); forms below carry no top border of their own. */}
      <div
        className={`divide-y divide-zinc-100 dark:divide-zinc-800 ${
          visibleSubtasks.length > 0 ? 'border-b border-zinc-100 dark:border-zinc-800' : ''
        }`}
      >
        {visibleSubtasks.map((subtask) => (
          <SubtaskItem
            key={subtask.id}
            subtask={subtask}
            themeName={themeName}
            categoryName={categoryName}
            isEditing={editingSubtaskId === subtask.id}
            isSelectionMode={isSubtaskSelectionMode}
            isSelected={selectedSubtaskIds.has(subtask.id)}
            isParallelExecutionRunning={isParallelExecutionRunning}
            executionStatus={getSubtaskStatus(subtask.id)}
            editingSubtaskTitle={editingSubtaskTitle}
            editingSubtaskDescription={editingSubtaskDescription}
            editingSubtaskPriority={editingSubtaskPriority}
            editingSubtaskEstimatedHours={editingSubtaskEstimatedHours}
            editingSubtaskActualHours={editingSubtaskActualHours}
            onToggleSelection={() => onToggleSubtaskSelection(subtask.id)}
            onStartEditing={onStartEditingSubtask}
            onSetEditingTitle={onSetEditingSubtaskTitle}
            onSetEditingDescription={onSetEditingSubtaskDescription}
            onSetEditingPriority={onSetEditingSubtaskPriority}
            onSetEditingEstimatedHours={onSetEditingSubtaskEstimatedHours}
            onSetEditingActualHours={onSetEditingSubtaskActualHours}
            onSaveEdit={onSaveSubtaskEdit}
            onCancelEdit={onCancelEditingSubtask}
            onUpdateStatus={onUpdateStatus}
          />
        ))}
      </div>

      {!isEditingAny && isAddFormVisible && (
        <AddSubtaskForm
          newSubtaskTitle={newSubtaskTitle}
          newSubtaskDescription={newSubtaskDescription}
          newSubtaskPriority={newSubtaskPriority}
          newSubtaskEstimatedHours={newSubtaskEstimatedHours}
          newSubtaskActualHours={newSubtaskActualHours}
          onSetNewSubtaskTitle={onSetNewSubtaskTitle}
          onSetNewSubtaskDescription={onSetNewSubtaskDescription}
          onSetNewSubtaskPriority={onSetNewSubtaskPriority}
          onSetNewSubtaskEstimatedHours={onSetNewSubtaskEstimatedHours}
          onSetNewSubtaskActualHours={onSetNewSubtaskActualHours}
          onAddSubtask={onAddSubtask}
        />
      )}
    </div>
  );
}
