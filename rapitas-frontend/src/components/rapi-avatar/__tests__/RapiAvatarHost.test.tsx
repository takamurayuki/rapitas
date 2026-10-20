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

/**
 * ラピ's own button, by her marker rather than by position.
 *
 * `getAllByRole('button')[0]` used to stand in for her, and once the panel is
 * open that is the panel's close button — it sits earlier in the DOM. Tests
 * that thought they were clicking her were clicking the X, which closes the
 * panel too, so they passed while measuring the wrong thing.
 */
const avatarButton = () => document.querySelector('[data-rapi-avatar="true"]') as HTMLElement;

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

  // Dismissing something that reads as speech by hunting for its X is the
  // wrong shape: you look away and it should stop. Escape already worked and
  // is keyboard-only.
  it('closes when something outside it is clicked', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open while it is being used', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  // The avatar is excluded from the outside-click, or its own toggle would
  // fight it: close on pointerdown, reopen on the click that follows.
  it('still toggles shut from the avatar rather than reopening', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    fireEvent.pointerDown(avatarButton());
    fireEvent.click(avatarButton());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // The task assistant moved off the task detail page into her, so the mode
  // has to exist for the handover to have gone anywhere.
  it('offers the task assistant as one of her modes', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.getByText('rapiAvatar.mode.consult')).toBeTruthy();
  });

  // A conversation with history in a 320px column is unreadable, so that one
  // mode gets more room than the others.
  it('widens the bubble for the conversation and not for the rest', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const panel = () => screen.getByRole('dialog');
    const narrow = panel().className;
    fireEvent.click(screen.getByText('rapiAvatar.mode.consult'));
    expect(panel().className).not.toBe(narrow);
    expect(narrow).toContain('w-80');
    expect(panel().className).not.toContain('w-80');
  });

  // It is ラピ speaking, so it has a tail pointing at her — without one it is
  // a panel that happens to be near her.
  it('speaks in a bubble with a tail', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const panel = screen.getByRole('dialog');
    expect(panel.getAttribute('data-speech-bubble')).toBe('true');
    expect(panel.querySelectorAll('[data-bubble-tail]')).toHaveLength(2);
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
