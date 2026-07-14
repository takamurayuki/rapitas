/**
 * SubtaskItem.test
 *
 * Verifies the view-mode description toggle: hidden by default, toggle button
 * shown only when a description exists, and click-to-expand/collapse.
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

// Markdown pipeline is irrelevant here — render children as-is.
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock('remark-gfm', () => ({ default: () => undefined }));
vi.mock('remark-breaks', () => ({ default: () => undefined }));

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
  editingSubtaskEstimatedHours: '',
  editingSubtaskActualHours: '',
  onToggleSelection: vi.fn(),
  onStartEditing: vi.fn(),
  onSetEditingTitle: vi.fn(),
  onSetEditingDescription: vi.fn(),
  onSetEditingPriority: vi.fn(),
  onSetEditingEstimatedHours: vi.fn(),
  onSetEditingActualHours: vi.fn(),
  onSaveEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onUpdateStatus: vi.fn(),
};

describe('SubtaskItem description', () => {
  it('説明はデフォルトで非表示、トグルボタンだけ表示される', () => {
    render(
      <SubtaskItem {...baseProps} subtask={makeSubtask({ description: 'API仕様を確認する' })} />,
    );
    expect(screen.queryByText('API仕様を確認する')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'expand', expanded: false })).toBeInTheDocument();
  });

  it('トグルクリックで説明が展開/折りたたみされる', () => {
    render(
      <SubtaskItem {...baseProps} subtask={makeSubtask({ description: 'API仕様を確認する' })} />,
    );
    const toggle = screen.getByRole('button', { name: 'expand' });
    fireEvent.click(toggle);
    expect(screen.getByText('API仕様を確認する')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByText('API仕様を確認する')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('説明が無い場合はトグルボタンを描画しない', () => {
    render(<SubtaskItem {...baseProps} subtask={makeSubtask()} />);
    expect(screen.queryByRole('button', { name: /expand|collapse/ })).not.toBeInTheDocument();
  });
});
