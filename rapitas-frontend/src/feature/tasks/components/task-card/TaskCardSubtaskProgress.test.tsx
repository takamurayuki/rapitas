import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskCardSubtaskProgress from './TaskCardSubtaskProgress';
import type { Task, Status } from '@/types';

const makeSubtask = (id: number, status: Status): Task => ({
  id,
  title: `Subtask ${id}`,
  status,
  priority: 'medium',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const defaultProps = {
  expanded: false,
  onToggle: vi.fn(),
  label: 'サブタスク',
};

describe('TaskCardSubtaskProgress', () => {
  it('完了数/総数が表示される', () => {
    render(
      <TaskCardSubtaskProgress
        {...defaultProps}
        subtasks={[makeSubtask(1, 'done'), makeSubtask(2, 'in-progress'), makeSubtask(3, 'todo')]}
      />,
    );
    expect(screen.getByRole('button', { name: 'サブタスク 1/3' })).toHaveTextContent('1/3');
  });

  it('内訳ツールチップ(完了/進行中/未着手)が付与される', () => {
    render(
      <TaskCardSubtaskProgress
        {...defaultProps}
        subtasks={[makeSubtask(1, 'done'), makeSubtask(2, 'in-progress'), makeSubtask(3, 'todo')]}
      />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('title', '完了 1 / 進行中 1 / 未着手 1');
  });

  it('バーが完了=green・進行中=blueのセグメントで描画される', () => {
    const { container } = render(
      <TaskCardSubtaskProgress
        {...defaultProps}
        subtasks={[
          makeSubtask(1, 'done'),
          makeSubtask(2, 'done'),
          makeSubtask(3, 'in-progress'),
          makeSubtask(4, 'todo'),
        ]}
      />,
    );
    const doneSegment = container.querySelector('.bg-green-500') as HTMLElement;
    const inProgressSegment = container.querySelector('.bg-blue-500') as HTMLElement;
    expect(doneSegment.style.width).toBe('50%');
    expect(inProgressSegment.style.width).toBe('25%');
  });

  it('blocked は進行中としてカウントされる', () => {
    render(
      <TaskCardSubtaskProgress
        {...defaultProps}
        subtasks={[makeSubtask(1, 'blocked' as Status), makeSubtask(2, 'todo')]}
      />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('title', '完了 0 / 進行中 1 / 未着手 1');
  });

  it('クリックで onToggle が呼ばれ、クリックイベントは親に伝播しない', () => {
    const onToggle = vi.fn();
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <TaskCardSubtaskProgress
          {...defaultProps}
          onToggle={onToggle}
          subtasks={[makeSubtask(1, 'todo')]}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('expanded 状態が aria-expanded に反映される', () => {
    render(
      <TaskCardSubtaskProgress
        {...defaultProps}
        expanded={true}
        subtasks={[makeSubtask(1, 'todo')]}
      />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('全サブタスク完了時はテキストが完了色(green)になる', () => {
    render(
      <TaskCardSubtaskProgress
        {...defaultProps}
        subtasks={[makeSubtask(1, 'done'), makeSubtask(2, 'done')]}
      />,
    );
    expect(screen.getByRole('button').className).toContain('text-green-600');
  });

  it('未完了ありの場合はテキストがアクセント色(indigo)になる', () => {
    render(
      <TaskCardSubtaskProgress
        {...defaultProps}
        subtasks={[makeSubtask(1, 'done'), makeSubtask(2, 'todo')]}
      />,
    );
    expect(screen.getByRole('button').className).toContain('text-indigo-600');
  });

  it('サブタスクが空なら何も描画しない', () => {
    const { container } = render(<TaskCardSubtaskProgress {...defaultProps} subtasks={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
