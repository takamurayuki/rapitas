/**
 * RapiAvatarHost.test
 *
 * The avatar absorbed the resumable-executions banner, which used to sit
 * in this corner permanently. What has to hold afterwards: the corner is
 * quiet until asked, and nothing the banner could do was lost — resuming
 * an interrupted execution is reachable nowhere else in the app.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/** Where the app thinks it is; drives the contextual tab. */
let pathname = '/dashboard';
let search = '';

const handleResume = vi.fn();
const handleResumeAll = vi.fn();
const handleDismiss = vi.fn();

/** What `useResumableExecutions` reports; replaced per test. */
let executionState: {
  executions: { id: number; taskId: number; taskTitle: string; status: string }[];
  runningCount: number;
  interruptedCount: number;
};

// Interpolated values are rendered too, so an assertion can check WHAT a
// message said and not merely that it appeared. The note about where a
// sentence was routed is only useful if it names the destination.
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));
vi.mock('@/hooks/useDarkMode', () => ({ useDarkMode: () => ({ isDarkMode: false }) }));
// Which tabs exist depends on whether a task is open, and ラピ learns that
// from the address bar — she has no props from the page.
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));
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
  pathname = '/dashboard';
  search = '';
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

  // It used to stay shut with nothing running. The panel carries her own
  // modes as well as the executions, so there is always something to open.
  //
  // It opened on the intake until the survey became the default: the first
  // question when you reach for her is "what needs me", and filing a task is
  // the second thing. The intake has to stay one tab away, which is the part
  // this still holds.
  it('opens with nothing running, on the survey, with the intake one tab away', () => {
    executionState = { executions: [], runningCount: 0, interruptedCount: 0 };
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('rapiAvatar.watch.title')).toBeTruthy();
    expect(screen.queryByTestId('exec-1')).toBeNull();

    fireEvent.click(screen.getByText('rapiAvatar.mode.create'));
    expect(screen.getByText('rapiAvatar.intake.title')).toBeTruthy();
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
  // has to exist for the handover to have gone anywhere — but only where it
  // can work. A tab whose entire content is "open a task first" spends a
  // fifth of the bar saying so.
  it('offers the task assistant only where there is a task', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.queryByText('rapiAvatar.mode.consult')).toBeNull();
  });

  it.each([
    ['the task page', '/tasks/42', ''],
    ['the slide panel over the list', '/', 'panel=42'],
  ])('offers it on %s', (_label, path, query) => {
    pathname = path;
    search = query;
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.getByText('rapiAvatar.mode.consult')).toBeTruthy();
  });

  // A conversation with history in a 320px column is unreadable, so that one
  // mode gets more room than the others.
  it('widens the bubble for the conversation and not for the rest', () => {
    pathname = '/tasks/42';
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const panel = () => screen.getByRole('dialog');
    const narrow = panel().className;
    fireEvent.click(screen.getByText('rapiAvatar.mode.consult'));
    expect(panel().className).not.toBe(narrow);
    expect(narrow).toContain('w-80');
    expect(panel().className).not.toContain('w-80');
  });

  // One job, described twice, was costing two tabs out of six.
  it('offers one tidy tab rather than two ways of choosing', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.getByText('rapiAvatar.mode.tidy')).toBeTruthy();
    expect(screen.queryByText('rapiAvatar.mode.cleanup')).toBeNull();
    expect(screen.queryByText('rapiAvatar.mode.bulk')).toBeNull();
  });

  // Four tabs off a task, five on one. The point of the exercise.
  it.each([
    ['off a task', '/dashboard', '', 4],
    ['on a task', '/tasks/42', '', 5],
  ])('shows %s exactly %i tabs', (_label, path, query, expected) => {
    pathname = path;
    search = query;
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const tabs = Array.from(document.querySelectorAll('button[aria-pressed]')).filter((b) =>
      (b.textContent ?? '').startsWith('rapiAvatar.mode.'),
    );
    expect(tabs).toHaveLength(expected);
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
    expect(screen.getByText('rapiAvatar.message.running:1')).toBeTruthy();
    fireEvent.click(avatarButton());
    expect(screen.queryByText('rapiAvatar.message.running:1')).toBeNull();
  });
});

/**
 * The front door: typing instead of choosing.
 *
 * The tabs are the fallback, so the thing worth proving is the handover —
 * that a sentence lands on the right tab with the sentence itself, and that
 * a refusal leaves the tabs exactly as they were.
 */
describe('typing at her', () => {
  const route = (answer: Record<string, unknown>) =>
    vi.stubGlobal('fetch', (url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            String(url).includes('/assistant/route')
              ? answer
              : { total: 0, categories: [], matches: [], results: [] },
          ),
      } as Response),
    );

  afterEach(() => vi.unstubAllGlobals());

  const say = (what: string) => {
    const box = screen.getByLabelText('rapiAvatar.prompt.label');
    fireEvent.change(box, { target: { value: what } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: false });
  };

  it('switches to the tab she routed it to', async () => {
    route({ routed: true, intent: 'ask', reason: '件数を尋ねているため' });
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.getByText('rapiAvatar.watch.title')).toBeTruthy();

    say('ブロックは何件？');
    await waitFor(() => expect(screen.getByText('rapiAvatar.ask.title')).toBeTruthy());
  });

  // Without this a misroute looks like the feature simply doing something
  // else, rather than like her having misread you.
  it('says where she took it, and why', async () => {
    route({ routed: true, intent: 'ask', reason: '件数を尋ねているため' });
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    say('ブロックは何件？');
    await waitFor(() =>
      expect(
        screen.getByText('rapiAvatar.prompt.tookItAs:rapiAvatar.mode.ask,件数を尋ねているため'),
      ).toBeTruthy(),
    );
  });

  // A shrug has to leave everything usable, which means staying put.
  it('stays where it was when she cannot tell', async () => {
    route({ routed: false });
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    say('うーん');
    await waitFor(() => expect(screen.getByText('rapiAvatar.prompt.unplaced')).toBeTruthy());
    expect(screen.getByText('rapiAvatar.watch.title')).toBeTruthy();
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
    expect(screen.getByText('rapiAvatar.message.waiting:1')).toBeTruthy();
  });
});
