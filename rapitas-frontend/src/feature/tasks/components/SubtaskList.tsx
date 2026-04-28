/**
 * SubtaskList
 *
 * Orchestrates the subtask management UI for a task detail view.
 * Delegates selection logic to useSubtaskSelection, header rendering to
 * SubtaskListHeader, individual rows to SubtaskItem, and the add form to
 * AddSubtaskForm.
 */
import { useState } from 'react';
import { type Task } from '@/types';
import { useTranslations } from 'next-intl';
import { type ParallelExecutionStatus } from './SubtaskExecutionStatus';
import { useSubtaskSelection } from './subtask/useSubtaskSelection';
import SubtaskListHeader from './subtask/SubtaskListHeader';
import SubtaskItem from './subtask/SubtaskItem';
import AddSubtaskForm from './subtask/AddSubtaskForm';

interface SubtaskListProps {
  subtasks?: Task[];
  isAddingSubtask: boolean;
  subtaskTitle: string;
  subtaskDescription: string;
  subtaskLabels: string;
  subtaskEstimatedHours: string;
  onStatusUpdate: (taskId: number, newStatus: string) => void;
  onDeleteSubtask: (subtaskId: number) => void;
  onStartAddingSubtask: () => void;
  onSubtaskTitleChange: (value: string) => void;
  onSubtaskDescriptionChange: (value: string) => void;
  onSubtaskLabelsChange: (value: string) => void;
  onSubtaskEstimatedHoursChange: (value: string) => void;
  onAddSubtask: () => void;
  onCancelAddingSubtask: () => void;
  onUpdateSubtask?: (subtaskId: number, data: { title?: string; description?: string }) => void;
  /** Function to get parallel execution status by subtask ID */
  getExecutionStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
  /** Whether parallel execution is running */
  isParallelExecutionRunning?: boolean;
  /** Bulk delete subtasks */
  onDeleteAllSubtasks?: () => void;
  /** Delete selected subtasks */
  onDeleteSelectedSubtasks?: (subtaskIds: number[]) => void;
}

export default function SubtaskList({
  subtasks = [],
  isAddingSubtask,
  subtaskTitle,
  subtaskDescription,
  subtaskLabels,
  subtaskEstimatedHours,
  onStatusUpdate,
  onDeleteSubtask,
  onStartAddingSubtask,
  onSubtaskTitleChange,
  onSubtaskDescriptionChange,
  onSubtaskLabelsChange,
  onSubtaskEstimatedHoursChange,
  onAddSubtask,
  onCancelAddingSubtask,
  onUpdateSubtask,
  getExecutionStatus,
  isParallelExecutionRunning = false,
  onDeleteAllSubtasks,
  onDeleteSelectedSubtasks,
}: SubtaskListProps) {
  const t = useTranslations('task');

  const [editingSubtaskId, setEditingSubtaskId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingDescription, setEditingDescription] = useState('');

  const completedSubtasks = subtasks.filter((s) => s.status === 'done');
  const activeSubtasks = subtasks.filter((s) => s.status !== 'done');
  const totalSubtasks = subtasks.length;
  const progressPercentage =
    totalSubtasks > 0 ? Math.round((completedSubtasks.length / totalSubtasks) * 100) : 0;

  const selection = useSubtaskSelection(subtasks);

  const startEditingSubtask = (subtask: Task) => {
    setEditingSubtaskId(subtask.id);
    setEditingTitle(subtask.title);
    setEditingDescription(subtask.description || '');
  };

  const cancelEditingSubtask = () => {
    setEditingSubtaskId(null);
    setEditingTitle('');
    setEditingDescription('');
  };

  const saveSubtaskEdit = () => {
    if (editingSubtaskId && editingTitle.trim() && onUpdateSubtask) {
      onUpdateSubtask(editingSubtaskId, {
        title: editingTitle,
        description: editingDescription || undefined,
      });
      cancelEditingSubtask();
    }
  };

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-8">
      <SubtaskListHeader
        totalSubtasks={totalSubtasks}
        completedCount={completedSubtasks.length}
        progressPercentage={progressPercentage}
        isSelectionMode={selection.isSelectionMode}
        selectedCount={selection.selectedSubtaskIds.size}
        showDeleteConfirm={selection.showDeleteConfirm}
        hasDeleteAll={!!onDeleteAllSubtasks}
        hasDeleteSelected={!!onDeleteSelectedSubtasks}
        onToggleSelectionMode={selection.toggleSelectionMode}
        onSelectAll={selection.selectAllSubtasks}
        onDeselectAll={selection.deselectAllSubtasks}
        onRequestDeleteSelected={() => selection.setShowDeleteConfirm('selected')}
        onRequestDeleteAll={() => selection.setShowDeleteConfirm('all')}
        onConfirmDelete={() => {
          if (selection.showDeleteConfirm === 'all') {
            selection.handleDeleteAll(onDeleteAllSubtasks);
          } else {
            selection.handleDeleteSelected(onDeleteSelectedSubtasks);
          }
        }}
        onCancelDelete={() => selection.setShowDeleteConfirm(null)}
      />

      {activeSubtasks.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
            {t('activeSubtasks')}
          </h3>
          <div className="space-y-3">
            {activeSubtasks.map((subtask) => (
              <SubtaskItem
                key={subtask.id}
                subtask={subtask}
                isCompleted={false}
                isSelectionMode={selection.isSelectionMode}
                isSelected={selection.selectedSubtaskIds.has(subtask.id)}
                isEditing={editingSubtaskId === subtask.id}
                editingTitle={editingTitle}
                editingDescription={editingDescription}
                isParallelExecutionRunning={isParallelExecutionRunning}
                executionStatus={getExecutionStatus?.(subtask.id)}
                onToggleSelect={selection.toggleSubtaskSelection}
                onStatusUpdate={onStatusUpdate}
                onDeleteSubtask={onDeleteSubtask}
                onStartEditing={startEditingSubtask}
                onSaveEdit={saveSubtaskEdit}
                onCancelEdit={cancelEditingSubtask}
                onEditingTitleChange={setEditingTitle}
                onEditingDescriptionChange={setEditingDescription}
                canEdit={!!onUpdateSubtask}
              />
            ))}
          </div>
        </div>
      )}

      {completedSubtasks.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-2">
            <svg
              className="w-5 h-5 text-green-600 dark:text-green-400"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            {t('completedSubtasks', { count: completedSubtasks.length })}
          </h3>
          <div className="space-y-2">
            {completedSubtasks.map((subtask) => (
              <SubtaskItem
                key={subtask.id}
                subtask={subtask}
                isCompleted={true}
                isSelectionMode={selection.isSelectionMode}
                isSelected={selection.selectedSubtaskIds.has(subtask.id)}
                isEditing={editingSubtaskId === subtask.id}
                editingTitle={editingTitle}
                editingDescription={editingDescription}
                isParallelExecutionRunning={isParallelExecutionRunning}
                executionStatus={getExecutionStatus?.(subtask.id)}
                onToggleSelect={selection.toggleSubtaskSelection}
                onStatusUpdate={onStatusUpdate}
                onDeleteSubtask={onDeleteSubtask}
                onStartEditing={startEditingSubtask}
                onSaveEdit={saveSubtaskEdit}
                onCancelEdit={cancelEditingSubtask}
                onEditingTitleChange={setEditingTitle}
                onEditingDescriptionChange={setEditingDescription}
                canEdit={!!onUpdateSubtask}
              />
            ))}
          </div>
        </div>
      )}

      <div className={totalSubtasks > 0 ? 'mt-6' : ''}>
        <AddSubtaskForm
          isAddingSubtask={isAddingSubtask}
          subtaskTitle={subtaskTitle}
          subtaskDescription={subtaskDescription}
          subtaskLabels={subtaskLabels}
          subtaskEstimatedHours={subtaskEstimatedHours}
          onSubtaskTitleChange={onSubtaskTitleChange}
          onSubtaskDescriptionChange={onSubtaskDescriptionChange}
          onSubtaskLabelsChange={onSubtaskLabelsChange}
          onSubtaskEstimatedHoursChange={onSubtaskEstimatedHoursChange}
          onAddSubtask={onAddSubtask}
          onCancelAddingSubtask={onCancelAddingSubtask}
          onStartAddingSubtask={onStartAddingSubtask}
        />
      </div>
    </div>
  );
}
