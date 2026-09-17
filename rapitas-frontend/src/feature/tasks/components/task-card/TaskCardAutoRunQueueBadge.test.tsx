import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskCardAutoRunQueueBadge from './TaskCardAutoRunQueueBadge';
import type { Task } from '@/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const createMockTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 1,
    title: 'Task',
    status: 'todo',
    priority: 'medium',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }) as Task;

describe('TaskCardAutoRunQueueBadge', () => {
  it('エージェント実行中は何も表示しない（既存の実行中バッジとの重複防止）', () => {
    const { container } = render(
      <TaskCardAutoRunQueueBadge
        task={createMockTask({ autoRunCurrent: true })}
        isExecuting={true}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('autoRunCurrent=true かつ非実行中 → 「次に着手」バッジを表示する', () => {
    render(
      <TaskCardAutoRunQueueBadge
        task={createMockTask({ autoRunCurrent: true, autoRunQueued: false })}
        isExecuting={false}
      />,
    );
    expect(screen.getByText('taskCard.autoRunNextUp')).toBeInTheDocument();
  });

  it('autoRunQueued=true かつ非実行中 → 「順番待ち」バッジを表示する', () => {
    render(
      <TaskCardAutoRunQueueBadge
        task={createMockTask({ autoRunCurrent: false, autoRunQueued: true })}
        isExecuting={false}
      />,
    );
    expect(screen.getByText('taskCard.autoRunQueued')).toBeInTheDocument();
  });

  it('どちらのフラグも false → 何も表示しない', () => {
    const { container } = render(
      <TaskCardAutoRunQueueBadge
        task={createMockTask({ autoRunCurrent: false, autoRunQueued: false })}
        isExecuting={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('両フラグとも未設定(undefined) → 何も表示しない', () => {
    const { container } = render(
      <TaskCardAutoRunQueueBadge task={createMockTask()} isExecuting={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('autoRunCurrent が autoRunQueued より優先される', () => {
    render(
      <TaskCardAutoRunQueueBadge
        task={createMockTask({ autoRunCurrent: true, autoRunQueued: true })}
        isExecuting={false}
      />,
    );
    expect(screen.getByText('taskCard.autoRunNextUp')).toBeInTheDocument();
    expect(screen.queryByText('taskCard.autoRunQueued')).not.toBeInTheDocument();
  });
});
