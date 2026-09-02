/**
 * pomodoroFloatEmptyState.test
 *
 * Verifies the idle UI shows the last used task (or the "no task" label),
 * the configured duration, and that Start calls startTimer with the
 * lastUsedTaskId/lastUsedTaskTitle pair (including the taskless null case).
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

  it('shows the no-task label and calls startTimer(null, null) when no task was used yet', () => {
    const startTimer = vi.fn();
    mockUsePomodoroStore.mockReturnValue({
      lastUsedTaskId: null,
      lastUsedTaskTitle: null,
      settings: { pomodoroDuration: 1500 },
      startTimer,
    });

    render(<PomodoroFloatEmptyState />);

    expect(screen.getByText('pomodoro.floatNoTaskLabel')).toBeInTheDocument();

    fireEvent.click(screen.getByText('pomodoro.start'));
    expect(startTimer).toHaveBeenCalledWith(null, null);
  });
});
