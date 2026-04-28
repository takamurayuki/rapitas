/**
 * useSubtaskSelection
 *
 * Custom hook for managing subtask selection mode and bulk-delete confirmation state.
 * Keeps selection logic isolated from rendering so SubtaskList stays focused on layout.
 */
import { useState } from 'react';
import { type Task } from '@/types';

/**
 * All values and handlers for subtask selection / bulk-delete UI.
 */
export interface SubtaskSelectionState {
  isSelectionMode: boolean;
  selectedSubtaskIds: Set<number>;
  showDeleteConfirm: 'all' | 'selected' | null;
  toggleSelectionMode: () => void;
  toggleSubtaskSelection: (subtaskId: number) => void;
  selectAllSubtasks: () => void;
  deselectAllSubtasks: () => void;
  setShowDeleteConfirm: React.Dispatch<React.SetStateAction<'all' | 'selected' | null>>;
  handleDeleteSelected: (onDeleteSelectedSubtasks?: (ids: number[]) => void) => void;
  handleDeleteAll: (onDeleteAllSubtasks?: () => void) => void;
}

/**
 * Manages subtask selection mode, per-item selection, and bulk-delete confirmation.
 *
 * @param subtasks - The full list of subtasks; used for "select all".
 * @returns Selection state and the handlers to manipulate it.
 */
export function useSubtaskSelection(subtasks: Task[]): SubtaskSelectionState {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedSubtaskIds, setSelectedSubtaskIds] = useState<Set<number>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<'all' | 'selected' | null>(null);

  const toggleSelectionMode = () => {
    if (isSelectionMode) {
      setSelectedSubtaskIds(new Set());
    }
    setIsSelectionMode((prev) => !prev);
  };

  const toggleSubtaskSelection = (subtaskId: number) => {
    setSelectedSubtaskIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(subtaskId)) {
        newSet.delete(subtaskId);
      } else {
        newSet.add(subtaskId);
      }
      return newSet;
    });
  };

  const selectAllSubtasks = () => {
    setSelectedSubtaskIds(new Set(subtasks.map((s) => s.id)));
  };

  const deselectAllSubtasks = () => {
    setSelectedSubtaskIds(new Set());
  };

  const handleDeleteSelected = (onDeleteSelectedSubtasks?: (ids: number[]) => void) => {
    if (selectedSubtaskIds.size > 0 && onDeleteSelectedSubtasks) {
      onDeleteSelectedSubtasks(Array.from(selectedSubtaskIds));
      setSelectedSubtaskIds(new Set());
      setIsSelectionMode(false);
      setShowDeleteConfirm(null);
    }
  };

  const handleDeleteAll = (onDeleteAllSubtasks?: () => void) => {
    if (onDeleteAllSubtasks) {
      onDeleteAllSubtasks();
      setShowDeleteConfirm(null);
    }
  };

  return {
    isSelectionMode,
    selectedSubtaskIds,
    showDeleteConfirm,
    toggleSelectionMode,
    toggleSubtaskSelection,
    selectAllSubtasks,
    deselectAllSubtasks,
    setShowDeleteConfirm,
    handleDeleteSelected,
    handleDeleteAll,
  };
}
