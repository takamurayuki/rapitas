/**
 * SubtaskItem.test
 *
 * Verifies the view-mode description display: shown when present,
 * click-to-expand toggling, and absent when the subtask has no description.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubtaskItem } from '../SubtaskItem';
import type { Task } from '@/types';

// next-intl mock echoes the key back so assertions can target the key path
// rather than a locale-specific string.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// The store hook takes a selector; feed it a stub state with no live execution.
vi.mock('@/stores/execution-state-store', () => ({
  useExecutionStateStore: (selector: (s: unknown) => unknown) =>
    selector({ getExecutingTaskStatus: () => null }),
}));

const makeSubtask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  title: 'Subtask 1',
  status: 'todo',
  priority: 'medium',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const baseProps = {
  isEditing: false,
  isSelectionMode: false,
  isSelected: false,
  isParallelExecutionRunning: false,
  executionStatus: undefined,
  editingSubtaskTitle: '',
  editingSubtaskDescription: '',
  editingSubtaskPriority: 'medium' as const,
  editingSubtaskLabels: '',
  editingSubtaskEstimatedHours: '',
  onToggleSelection: vi.fn(),
  onStartEditing: vi.fn(),
  onSetEditingTitle: vi.fn(),
  onSetEditingDescription: vi.fn(),
  onSetEditingPriority: vi.fn(),
  onSetEditingLabels: vi.fn(),
  onSetEditingEstimatedHours: vi.fn(),
  onSaveEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onUpdateStatus: vi.fn(),
};

describe('SubtaskItem description', () => {
  it('説明がある場合は表示モードで説明が見える', () => {
    render(
      <SubtaskItem {...baseProps} subtask={makeSubtask({ description: 'API仕様を確認する' })} />,
    );
    expect(screen.getByText('API仕様を確認する')).toBeInTheDocument();
  });

  it('説明クリックで展開/折りたたみが切り替わる', () => {
    render(
      <SubtaskItem {...baseProps} subtask={makeSubtask({ description: 'long description' })} />,
    );
    const toggle = screen.getByText('long description');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('説明が無い場合は説明トグルを描画しない', () => {
    render(<SubtaskItem {...baseProps} subtask={makeSubtask()} />);
    expect(screen.queryByRole('button', { name: /expand|collapse/ })).not.toBeInTheDocument();
  });
});
