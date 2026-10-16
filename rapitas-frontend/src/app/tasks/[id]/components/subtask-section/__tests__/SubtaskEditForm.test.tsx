/**
 * SubtaskEditForm.test
 *
 * Verifies the edit form's note-link section: notes link against the subtask's
 * ID and "insert to description" appends a markdown link to the draft
 * description.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubtaskEditForm } from '../SubtaskEditForm';
import type { Task } from '@/types';

// next-intl mock echoes the key back so assertions can target the key path
// rather than a locale-specific string.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Stub NoteLinksSection with a button that triggers the insert callback so the
// append logic can be exercised without the note store / portals.
vi.mock('../../NoteLinksSection', () => ({
  default: ({
    taskId,
    onInsertToDescription,
  }: {
    taskId: number;
    onInsertToDescription?: (link: string) => void;
  }) => (
    <button
      data-testid={`note-links-${taskId}`}
      onClick={() => onInsertToDescription?.('[メモ](/rapitas-note/5/n1)')}
    >
      insert-note
    </button>
  ),
}));

const subtask: Task = {
  id: 5,
  title: 'Subtask 5',
  status: 'todo',
  priority: 'medium',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const baseProps = {
  subtask,
  editingSubtaskTitle: 'Subtask 5',
  editingSubtaskDescription: '',
  editingSubtaskPriority: 'medium' as const,
  editingSubtaskEstimatedHours: '',
  editingSubtaskActualHours: '',
  onSetEditingTitle: vi.fn(),
  onSetEditingDescription: vi.fn(),
  onSetEditingPriority: vi.fn(),
  onSetEditingEstimatedHours: vi.fn(),
  onSetEditingActualHours: vi.fn(),
  onSaveEdit: vi.fn(),
  onCancelEdit: vi.fn(),
};

describe('SubtaskEditForm note links', () => {
  it('サブタスクIDでNoteLinksSectionが描画される', () => {
    render(<SubtaskEditForm {...baseProps} />);
    expect(screen.getByTestId('note-links-5')).toBeInTheDocument();
  });

  it('説明が空のとき挿入でリンクだけがセットされる', () => {
    const onSetEditingDescription = vi.fn();
    render(<SubtaskEditForm {...baseProps} onSetEditingDescription={onSetEditingDescription} />);
    fireEvent.click(screen.getByTestId('note-links-5'));
    expect(onSetEditingDescription).toHaveBeenCalledWith('[メモ](/rapitas-note/5/n1)');
  });

  it('既存の説明があるとき挿入で改行して追記される', () => {
    const onSetEditingDescription = vi.fn();
    render(
      <SubtaskEditForm
        {...baseProps}
        editingSubtaskDescription="既存の説明"
        onSetEditingDescription={onSetEditingDescription}
      />,
    );
    fireEvent.click(screen.getByTestId('note-links-5'));
    expect(onSetEditingDescription).toHaveBeenCalledWith('既存の説明\n[メモ](/rapitas-note/5/n1)');
  });
});
