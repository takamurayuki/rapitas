'use client';

/**
 * SubtaskSection
 *
 * Orchestrates the subtask card: header, delete confirmation, add form, and item list.
 * All state is owned by the parent and threaded in as props.
 */

import type { Task, Priority } from '@/types';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import { SubtaskHeader } from './subtask-section/SubtaskHeader';
import { SubtaskDeleteConfirm } from './subtask-section/SubtaskDeleteConfirm';
import { AddSubtaskForm } from './subtask-section/AddSubtaskForm';
import { SubtaskItem } from './subtask-section/SubtaskItem';

interface SubtaskSectionProps {
  subtasks: NonNullable<Task['subtasks']>;
  isSubtaskSelectionMode: boolean;
  selectedSubtaskIds: Set<number>;
  showSubtaskDeleteConfirm: 'all' | 'selected' | null;
  editingSubtaskId: number | null;
  editingSubtaskTitle: string;
  editingSubtaskDescription: string;
  editingSubtaskPriority: Priority;
  editingSubtaskLabels: string;
  editingSubtaskEstimatedHours: string;
  isParallelExecutionRunning: boolean;
  getSubtaskStatus: (subtaskId: number) => ParallelExecutionStatus | undefined;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onToggleSubtaskSelection: (id: number) => void;
  onSetDeleteConfirm: (v: 'all' | 'selected' | null) => void;
  onDeleteAll: () => void;
  onDeleteSelected: () => void;
  onStartEditingSubtask: (subtask: NonNullable<Task['subtasks']>[number]) => void;
  onSetEditingSubtaskTitle: (v: string) => void;
  onSetEditingSubtaskDescription: (v: string) => void;
  onSetEditingSubtaskPriority: (v: Priority) => void;
  onSetEditingSubtaskLabels: (v: string) => void;
  onSetEditingSubtaskEstimatedHours: (v: string) => void;
  onSaveSubtaskEdit: () => void;
  onCancelEditingSubtask: () => void;
  onUpdateStatus: (id: number, status: string) => void;
  isAddingSubtask: boolean;
  newSubtaskTitle: string;
  newSubtaskDescription: string;
  newSubtaskLabels: string;
  newSubtaskEstimatedHours: string;
  onToggleAddSubtask: () => void;
  onSetNewSubtaskTitle: (v: string) => void;
  onSetNewSubtaskDescription: (v: string) => void;
  onSetNewSubtaskLabels: (v: string) => void;
  onSetNewSubtaskEstimatedHours: (v: string) => void;
  onAddSubtask: () => void;
  onCancelAddSubtask: () => void;
}

export default function SubtaskSection({
  subtasks,
  isSubtaskSelectionMode,
  selectedSubtaskIds,
  showSubtaskDeleteConfirm,
  editingSubtaskId,
  editingSubtaskTitle,
  editingSubtaskDescription,
  editingSubtaskPriority,
  editingSubtaskLabels,
  editingSubtaskEstimatedHours,
  isParallelExecutionRunning,
  getSubtaskStatus,
  onToggleSelectionMode,
  onSelectAll,
  onDeselectAll,
  onToggleSubtaskSelection,
  onSetDeleteConfirm,
  onDeleteAll,
  onDeleteSelected,
  onStartEditingSubtask,
  onSetEditingSubtaskTitle,
  onSetEditingSubtaskDescription,
  onSetEditingSubtaskPriority,
  onSetEditingSubtaskLabels,
  onSetEditingSubtaskEstimatedHours,
  onSaveSubtaskEdit,
  onCancelEditingSubtask,
  onUpdateStatus,
  isAddingSubtask,
  newSubtaskTitle,
  newSubtaskDescription,
  newSubtaskLabels,
  newSubtaskEstimatedHours,
  onToggleAddSubtask,
  onSetNewSubtaskTitle,
  onSetNewSubtaskDescription,
  onSetNewSubtaskLabels,
  onSetNewSubtaskEstimatedHours,
  onAddSubtask,
  onCancelAddSubtask,
}: SubtaskSectionProps) {
  const doneCount = subtasks.filter((s) => s.status === 'done').length;
  const hasSubtasks = subtasks.length > 0;
  const progressPercent = hasSubtasks ? Math.round((doneCount / subtasks.length) * 100) : 0;

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden mb-6">
      <SubtaskHeader
        subtasks={subtasks}
        doneCount={doneCount}
        progressPercent={progressPercent}
        isSubtaskSelectionMode={isSubtaskSelectionMode}
        selectedSubtaskIds={selectedSubtaskIds}
        onToggleAddSubtask={onToggleAddSubtask}
        onToggleSelectionMode={onToggleSelectionMode}
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        onSetDeleteConfirm={onSetDeleteConfirm}
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

      {isAddingSubtask && (
        <AddSubtaskForm
          newSubtaskTitle={newSubtaskTitle}
          newSubtaskDescription={newSubtaskDescription}
          newSubtaskLabels={newSubtaskLabels}
          newSubtaskEstimatedHours={newSubtaskEstimatedHours}
          onSetNewSubtaskTitle={onSetNewSubtaskTitle}
          onSetNewSubtaskDescription={onSetNewSubtaskDescription}
          onSetNewSubtaskLabels={onSetNewSubtaskLabels}
          onSetNewSubtaskEstimatedHours={onSetNewSubtaskEstimatedHours}
          onAddSubtask={onAddSubtask}
          onCancelAddSubtask={onCancelAddSubtask}
        />
      )}

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {subtasks.map((subtask) => (
          <SubtaskItem
            key={subtask.id}
            subtask={subtask}
            isEditing={editingSubtaskId === subtask.id}
            isSelectionMode={isSubtaskSelectionMode}
            isSelected={selectedSubtaskIds.has(subtask.id)}
            isParallelExecutionRunning={isParallelExecutionRunning}
            executionStatus={getSubtaskStatus(subtask.id)}
            editingSubtaskTitle={editingSubtaskTitle}
            editingSubtaskDescription={editingSubtaskDescription}
            editingSubtaskPriority={editingSubtaskPriority}
            editingSubtaskLabels={editingSubtaskLabels}
            editingSubtaskEstimatedHours={editingSubtaskEstimatedHours}
            onToggleSelection={() => onToggleSubtaskSelection(subtask.id)}
            onStartEditing={onStartEditingSubtask}
            onSetEditingTitle={onSetEditingSubtaskTitle}
            onSetEditingDescription={onSetEditingSubtaskDescription}
            onSetEditingPriority={onSetEditingSubtaskPriority}
            onSetEditingLabels={onSetEditingSubtaskLabels}
            onSetEditingEstimatedHours={onSetEditingSubtaskEstimatedHours}
            onSaveEdit={onSaveSubtaskEdit}
            onCancelEdit={onCancelEditingSubtask}
            onUpdateStatus={onUpdateStatus}
          />
        ))}
      </div>
    </div>
  );
}
