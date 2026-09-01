/**
 * PomodoroTimer tests
 *
 * Focuses on the checkpoint ("途中記録") button added by task #819: it must
 * call the sync layer's checkpoint() and surface a success toast without
 * touching the timer's running/paused state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PomodoroTimer from './PomodoroTimer';

const { showToastMock, checkpointMock } = vi.hoisted(() => ({
  showToastMock: vi.fn(),
  checkpointMock: vi.fn(),
}));

vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://localhost:3001',
}));

vi.mock('../../pomodoro/pomodoro-sync', () => ({
  syncPomodoroToBackend: {
    start: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
    checkpoint: checkpointMock,
  },
}));

const RUNNING_STATE = {
  taskId: 1,
  taskTitle: 'テストタスク',
  isTimerRunning: true,
  isPaused: false,
  isBreakTime: false,
  pomodoroCount: 0,
  pomodoroSeconds: 30,
  workSeconds: 30,
  accumulatedBreakSeconds: 0,
  timerStartTime: Date.now(),
  showBreakDialog: false,
  showBreakEndDialog: false,
};

vi.mock('../../pomodoro/pomodoro-store', () => ({
  usePomodoroStore: () => ({
    ...RUNNING_STATE,
    startTimer: vi.fn(),
    pauseTimer: vi.fn(),
    resumeTimer: vi.fn(),
    stopTimer: vi.fn(),
    takeBreak: vi.fn(),
    skipBreak: vi.fn(),
    endBreak: vi.fn(),
  }),
  formatTime: (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
  DEFAULT_POMODORO_DURATION: 1500,
  DEFAULT_SHORT_BREAK: 300,
  DEFAULT_LONG_BREAK: 900,
}));

describe('PomodoroTimer — checkpoint button', () => {
  beforeEach(() => {
    checkpointMock.mockReset();
    showToastMock.mockReset();
  });

  const renderTimer = () =>
    render(
      <PomodoroTimer taskId={1} taskTitle="テストタスク" timeEntries={[]} onUpdate={vi.fn()} />,
    );

  it('途中記録ボタンに aria-label が設定されていること', () => {
    renderTimer();
    expect(screen.getByRole('button', { name: 'checkpointButton' })).toBeInTheDocument();
  });

  it('途中記録ボタン押下で checkpoint が呼ばれ、記録分数がある場合はトースト表示すること', async () => {
    checkpointMock.mockResolvedValue({ studyMinutesRecorded: 12 });
    renderTimer();

    fireEvent.click(screen.getByRole('button', { name: 'checkpointButton' }));

    expect(checkpointMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(showToastMock).toHaveBeenCalledTimes(1));
    expect(showToastMock).toHaveBeenCalledWith('checkpointToast:{"minutes":12}', 'success');
  });

  it('記録分数が0の場合はトーストを表示しないこと(テーマ未紐づけ等のno-op)', async () => {
    checkpointMock.mockResolvedValue({ studyMinutesRecorded: 0 });
    renderTimer();

    fireEvent.click(screen.getByRole('button', { name: 'checkpointButton' }));

    await waitFor(() => expect(checkpointMock).toHaveBeenCalledTimes(1));
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('アクティブセッションが無い場合(null)はトーストを表示しないこと', async () => {
    checkpointMock.mockResolvedValue(null);
    renderTimer();

    fireEvent.click(screen.getByRole('button', { name: 'checkpointButton' }));

    await waitFor(() => expect(checkpointMock).toHaveBeenCalledTimes(1));
    expect(showToastMock).not.toHaveBeenCalled();
  });
});
