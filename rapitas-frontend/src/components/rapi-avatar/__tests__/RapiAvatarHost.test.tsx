/**
 * RapiAvatarHost.test
 *
 * The avatar absorbed the resumable-executions banner, which used to sit
 * in this corner permanently. What has to hold afterwards: the corner is
 * quiet until asked, and nothing the banner could do was lost — resuming
 * an interrupted execution is reachable nowhere else in the app.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const handleResume = vi.fn();
const handleResumeAll = vi.fn();
const handleDismiss = vi.fn();

/** What `useResumableExecutions` reports; replaced per test. */
let executionState: {
  executions: { id: number; taskId: number; taskTitle: string; status: string }[];
  runningCount: number;
  interruptedCount: number;
};

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock('@/hooks/useDarkMode', () => ({ useDarkMode: () => ({ isDarkMode: false }) }));
vi.mock('../useRapiAvatarState', () => ({
  useRapiAvatarState: (interrupted: number) => ({
    state: interrupted > 0 ? 'waiting' : 'running',
    agents: 1,
  }),
}));
vi.mock('@/components/resumable-executions/useResumableExecutions', () => ({
  useResumableExecutions: () => ({
    ...executionState,
    resumingIds: new Set<number>(),
    dismissingIds: new Set<number>(),
    handleResume,
    handleResumeAll,
    handleDismiss,
    formatTimeAgo: () => '1分前',
  }),
}));
vi.mock('@/components/resumable-executions/ExecutionItem', () => ({
  ExecutionItem: ({ exec }: { exec: { id: number; taskTitle: string } }) => (
    <li data-testid={`exec-${exec.id}`}>{exec.taskTitle}</li>
  ),
}));

import RapiAvatarHost from '../RapiAvatarHost';

const exec = (id: number, status: string) => ({
  id,
  taskId: id,
  taskTitle: `task ${id}`,
  status,
});

beforeEach(() => {
  handleResume.mockReset();
  handleResumeAll.mockReset();
  handleDismiss.mockReset();
  executionState = { executions: [exec(1, 'running')], runningCount: 1, interruptedCount: 0 };
});

/** The avatar's own button, which opens the panel. */
const avatarButton = () => screen.getAllByRole('button')[0];

describe('the corner', () => {
  // The whole point of the change: nothing is parked there any more.
  it('holds only the avatar until it is asked', () => {
    render(<RapiAvatarHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('exec-1')).toBeNull();
  });

  it('opens the panel when the avatar is clicked', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByTestId('exec-1')).toBeTruthy();
  });

  it('closes again on a second click', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    fireEvent.click(avatarButton());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // It used to stay shut with nothing running. The panel now carries ラピ's
  // intake as well as the executions, so there is always something to open.
  it('opens with nothing running, holding the intake alone', () => {
    executionState = { executions: [], runningCount: 0, interruptedCount: 0 };
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('rapiAvatar.intake.title')).toBeTruthy();
    expect(screen.queryByTestId('exec-1')).toBeNull();
  });

  // Two things talking at once in one corner is what this removed.
  it('hushes the bubble while the panel is up', () => {
    render(<RapiAvatarHost />);
    expect(screen.getByText('rapiAvatar.message.running')).toBeTruthy();
    fireEvent.click(avatarButton());
    expect(screen.queryByText('rapiAvatar.message.running')).toBeNull();
  });
});

/** The banner's unique job: it exists nowhere else, so it had to survive. */
describe('resuming interrupted work', () => {
  beforeEach(() => {
    executionState = {
      executions: [exec(1, 'interrupted'), exec(2, 'interrupted')],
      runningCount: 0,
      interruptedCount: 2,
    };
  });

  it('offers resume-all when something can be resumed', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    fireEvent.click(screen.getByText('banner.resumeAll'));
    expect(handleResumeAll).toHaveBeenCalledTimes(1);
  });

  it('lists every interrupted execution', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.getByTestId('exec-1')).toBeTruthy();
    expect(screen.getByTestId('exec-2')).toBeTruthy();
  });

  it('does not offer resume-all when everything is already running', () => {
    executionState = { executions: [exec(1, 'running')], runningCount: 1, interruptedCount: 0 };
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.queryByText('banner.resumeAll')).toBeNull();
  });

  // The avatar is now the only sign that interrupted work exists.
  it('shows it as something the user has to deal with', () => {
    render(<RapiAvatarHost />);
    expect(screen.getByText('rapiAvatar.message.waiting')).toBeTruthy();
  });
});
