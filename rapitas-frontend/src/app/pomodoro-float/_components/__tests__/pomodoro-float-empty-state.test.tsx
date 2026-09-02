/**
 * pomodoroFloatEmptyState.test
 *
 * Verifies the idle UI shows the handed-over/last-used task with a Start
 * button, and — with no task — only points at the task detail page (sessions
 * are task-bound; there is no taskless start and no in-float picker).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PomodoroFloatEmptyState from '../pomodoro-float-empty-state';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

const { mockUsePomodoroStore } = vi.hoisted(() => ({ mockUsePomodoroStore: vi.fn() }));

vi.mock('@/feature/tasks/pomodoro/pomodoro-store', () => ({
  usePomodoroStore: () => mockUsePomodoroStore(),
  formatTime: (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
}));

describe('PomodoroFloatEmptyState', () => {
  it('shows the last used task title and calls startTimer with its id on Start', () => {
    const startTimer = vi.fn();
    mockUsePomodoroStore.mockReturnValue({
      lastUsedTaskId: 5,
      lastUsedTaskTitle: 'My Task',
      settings: { pomodoroDuration: 1500 },
      startTimer,
    });

    render(<PomodoroFloatEmptyState />);

    expect(screen.getByText('My Task')).toBeInTheDocument();
    expect(screen.getByText('25:00')).toBeInTheDocument();

    fireEvent.click(screen.getByText('pomodoro.start'));
    expect(startTimer).toHaveBeenCalledWith(5, 'My Task');
  });

  it('points at the task detail page and hides Start when no task was handed over', () => {
    const startTimer = vi.fn();
    mockUsePomodoroStore.mockReturnValue({
      lastUsedTaskId: null,
      lastUsedTaskTitle: null,
      settings: { pomodoroDuration: 1500 },
      startTimer,
    });

    render(<PomodoroFloatEmptyState />);

    expect(screen.getByText('pomodoro.floatOpenFromTaskDetail')).toBeInTheDocument();
    expect(screen.queryByText('pomodoro.start')).not.toBeInTheDocument();
    expect(startTimer).not.toHaveBeenCalled();
  });
});
