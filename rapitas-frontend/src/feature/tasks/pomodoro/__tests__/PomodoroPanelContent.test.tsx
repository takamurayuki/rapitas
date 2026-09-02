/**
 * PomodoroPanelContent.test
 *
 * Verifies focus-mode hides the task label/stats/settings, that fetched task
 * data is forwarded to PomodoroTimer, and that a 404 on the task fetch stops
 * the timer (so the float window falls back to its empty state).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PomodoroPanelContent from '../PomodoroPanelContent';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const stopTimer = vi.fn();
const mockStore = {
  stopTimer,
  updateSettings: vi.fn(),
  settings: {
    soundEnabled: false,
    soundVolume: 0.5,
    pomodoroDuration: 1500,
    shortBreakDuration: 300,
    longBreakDuration: 900,
  },
  todayCompletedPomodoros: 2,
  todayTotalWorkSeconds: 3600,
};
vi.mock('../pomodoro-store', () => ({
  usePomodoroStore: () => mockStore,
  formatTime: (s: number) => `fmt:${s}`,
}));

interface CapturedTimerProps {
  taskId: number;
  taskTitle?: string;
  estimatedHours?: number | null;
  actualHours?: number | null;
  subtasks?: unknown[];
}
let capturedProps: CapturedTimerProps | null = null;
vi.mock('@/feature/tasks/components/timer/PomodoroTimer', () => ({
  default: (props: CapturedTimerProps) => {
    capturedProps = props;
    return <div data-testid="pomodoro-timer" />;
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('PomodoroPanelContent', () => {
  beforeEach(() => {
    stopTimer.mockReset();
    capturedProps = null;
  });

  it('hides task label, stats, and settings in focus mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
    );
    render(<PomodoroPanelContent taskId={5} taskTitle="My Task" focusMode={true} />);

    expect(screen.queryByText('My Task')).not.toBeInTheDocument();
    expect(screen.queryByText('pomodoro.todayStats')).not.toBeInTheDocument();
    expect(screen.queryByText('pomodoro.settings')).not.toBeInTheDocument();
    // The timer itself is always shown.
    expect(screen.getByTestId('pomodoro-timer')).toBeInTheDocument();
  });

  it('shows task label, stats, and settings when not in focus mode', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
    );
    render(<PomodoroPanelContent taskId={5} taskTitle="My Task" focusMode={false} />);

    expect(screen.getByText('My Task')).toBeInTheDocument();
    expect(screen.getByText('pomodoro.todayStats')).toBeInTheDocument();
    expect(screen.getByText('pomodoro.settings')).toBeInTheDocument();
  });

  it('forwards fetched task data to PomodoroTimer', async () => {
    const fetchMock = vi
      .fn()
      // time-entries
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      // task
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ estimatedHours: 4, actualHours: 1, subtasks: [] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<PomodoroPanelContent taskId={9} taskTitle="T" focusMode={false} />);

    await waitFor(() => expect(capturedProps?.estimatedHours).toBe(4));
    expect(capturedProps?.actualHours).toBe(1);
    expect(capturedProps?.taskId).toBe(9);
  });

  it('stops the timer when the task fetch returns 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve(null) });
    vi.stubGlobal('fetch', fetchMock);

    render(<PomodoroPanelContent taskId={404} taskTitle="Gone" focusMode={false} />);

    await flush();
    await waitFor(() => expect(stopTimer).toHaveBeenCalledTimes(1));
  });
});
