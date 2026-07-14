/**
 * SubtaskSection.test
 *
 * Verifies the card's mode focus behaviour: edit mode shows only the edited
 * item, and add mode shows only the add form (list hidden, closed by default).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SubtaskSection from '../SubtaskSection';
import type { Task } from '@/types';

// next-intl mock echoes the key back so assertions can target the key path
// rather than a locale-specific string.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('../subtask-section/SubtaskHeader', () => ({
  SubtaskHeader: ({ onToggleAddForm }: { onToggleAddForm: () => void }) => (
    <button data-testid="toggle-add-form" onClick={onToggleAddForm} />
  ),
}));
vi.mock('../subtask-section/SubtaskDeleteConfirm', () => ({
  SubtaskDeleteConfirm: () => <div data-testid="subtask-delete-confirm" />,
}));
vi.mock('../subtask-section/AddSubtaskForm', () => ({
  AddSubtaskForm: () => <div data-testid="add-subtask-form" />,
}));
vi.mock('../subtask-section/SubtaskItem', () => ({
  SubtaskItem: ({ subtask, isEditing }: { subtask: Task; isEditing: boolean }) => (
    <div data-testid={`subtask-item-${subtask.id}`}>
      {subtask.title}
      {isEditing ? ' (editing)' : ''}
    </div>
  ),
}));

const makeSubtask = (id: number): Task => ({
  id,
  title: `Subtask ${id}`,
  status: 'todo',
  priority: 'medium',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const baseProps = {
  subtasks: [makeSubtask(1), makeSubtask(2), makeSubtask(3)],
  isSubtaskSelectionMode: false,
  selectedSubtaskIds: new Set<number>(),
  showSubtaskDeleteConfirm: null,
  editingSubtaskId: null,
  editingSubtaskTitle: '',
  editingSubtaskDescription: '',
  editingSubtaskPriority: 'medium' as const,
  editingSubtaskEstimatedHours: '',
  editingSubtaskActualHours: '',
  isParallelExecutionRunning: false,
  getSubtaskStatus: () => undefined,
  onToggleSelectionMode: vi.fn(),
  onSelectAll: vi.fn(),
  onDeselectAll: vi.fn(),
  onToggleSubtaskSelection: vi.fn(),
  onSetDeleteConfirm: vi.fn(),
  onDeleteAll: vi.fn(),
  onDeleteSelected: vi.fn(),
  onStartEditingSubtask: vi.fn(),
  onSetEditingSubtaskTitle: vi.fn(),
  onSetEditingSubtaskDescription: vi.fn(),
  onSetEditingSubtaskPriority: vi.fn(),
  onSetEditingSubtaskEstimatedHours: vi.fn(),
  onSetEditingSubtaskActualHours: vi.fn(),
  onSaveSubtaskEdit: vi.fn(),
  onCancelEditingSubtask: vi.fn(),
  onUpdateStatus: vi.fn(),
  newSubtaskTitle: '',
  newSubtaskDescription: '',
  newSubtaskPriority: 'medium' as const,
  newSubtaskEstimatedHours: '',
  newSubtaskActualHours: '',
  onSetNewSubtaskTitle: vi.fn(),
  onSetNewSubtaskDescription: vi.fn(),
  onSetNewSubtaskPriority: vi.fn(),
  onSetNewSubtaskEstimatedHours: vi.fn(),
  onSetNewSubtaskActualHours: vi.fn(),
  onAddSubtask: vi.fn(),
};

describe('SubtaskSection', () => {
  it('デフォルトは全サブタスクを表示し、追加フォームは非表示', () => {
    render(<SubtaskSection {...baseProps} />);
    expect(screen.getByTestId('subtask-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('subtask-item-2')).toBeInTheDocument();
    expect(screen.getByTestId('subtask-item-3')).toBeInTheDocument();
    expect(screen.queryByTestId('add-subtask-form')).not.toBeInTheDocument();
  });

  it('追加トグルで追加フォームのみ表示され、リストは隠れる', () => {
    render(<SubtaskSection {...baseProps} />);
    fireEvent.click(screen.getByTestId('toggle-add-form'));
    expect(screen.getByTestId('add-subtask-form')).toBeInTheDocument();
    // リストコンテナは hidden クラスで非表示になる
    expect(screen.getByTestId('subtask-item-1').parentElement).toHaveClass('hidden');
  });

  it('編集中は編集対象のサブタスクのみ表示する', () => {
    render(<SubtaskSection {...baseProps} editingSubtaskId={2} />);
    expect(screen.queryByTestId('subtask-item-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('subtask-item-2')).toHaveTextContent('Subtask 2 (editing)');
    expect(screen.queryByTestId('subtask-item-3')).not.toBeInTheDocument();
  });

  it('編集中は新規追加フォームを表示しない', () => {
    render(<SubtaskSection {...baseProps} editingSubtaskId={2} />);
    expect(screen.queryByTestId('add-subtask-form')).not.toBeInTheDocument();
  });
});
