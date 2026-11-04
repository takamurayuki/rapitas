/**
 * TaskCardSubtaskPanel.test
 *
 * The subtask rows inside a task card draw the done check in the same green as
 * the row's left line, matching the task card itself (user request, 2026-11-04).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Task } from '@/types';
import TaskCardSubtaskPanel from './TaskCardSubtaskPanel';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/stores/execution-state-store', () => ({
  useExecutionStateStore: (selector: (s: unknown) => unknown) =>
    selector({ executingTasks: new Map() }),
}));

vi.mock('@/feature/tasks/components/status/SubtaskStatusButtons', () => ({
  default: () => null,
}));

const subtask = {
  id: 7,
  title: 'Write the test',
  status: 'done',
  priority: 'medium',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as Task;

describe('TaskCardSubtaskPanel', () => {
  it('draws the done icon in the green of the left line', () => {
    render(<TaskCardSubtaskPanel subtasks={[subtask]} onStatusChange={vi.fn()} />);
    const chip = screen.getByLabelText('statusDone');
    expect(chip.className).toContain('text-green-500');
    expect(chip.className).not.toContain('text-green-700');
  });
});
