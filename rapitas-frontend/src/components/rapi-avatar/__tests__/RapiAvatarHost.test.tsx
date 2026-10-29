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
/** How many times the resumable-executions hook ran; it costs a request. */
let resumableCalls = 0;
vi.mock('@/components/resumable-executions/useResumableExecutions', () => ({
  useResumableExecutions: () => {
    resumableCalls += 1;
    return {
      ...executionState,
      resumingIds: new Set<number>(),
      dismissingIds: new Set<number>(),
      handleResume,
      handleResumeAll,
      handleDismiss,
      formatTimeAgo: () => '1分前',
    };
  },
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
  resumableCalls = 0;
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
  it('opens with nothing running, on the conversation, with the rest one tab away', () => {
    // It used to open on the survey. The conversation is the tab the box at
    // the bottom belongs to, so that is where it opens now (2026-10-22).
    executionState = { executions: [], runningCount: 0, interruptedCount: 0 };
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('rapiAvatar.greeting')).toBeTruthy();
    expect(screen.queryByTestId('exec-1')).toBeNull();

    fireEvent.click(screen.getByLabelText('rapiAvatar.mode.watch'));
    expect(screen.getByText('rapiAvatar.watch.title')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('rapiAvatar.mode.create'));
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
    expect(screen.getByLabelText('rapiAvatar.mode.consult')).toBeTruthy();
  });

  // It used to widen for `consult` alone, on the argument that a conversation
  // in a 320px column is unreadable. In use that reads as the panel jumping
  // size when you press one tab, which is worse than the cramped column it
  // was avoiding - reported 2026-10-22. One width, every tab.
  it('keeps one width whichever tab is showing', () => {
    pathname = '/tasks/42';
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const panel = () => screen.getByRole('dialog');
    const before = panel().className;
    fireEvent.click(screen.getByLabelText('rapiAvatar.mode.consult'));
    expect(panel().className).toBe(before);
    expect(panel().className).toContain('w-80');
  });

  // One job, described twice, was costing two tabs out of six.
  it('offers one tidy tab rather than two ways of choosing', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.getByLabelText('rapiAvatar.mode.tidy')).toBeTruthy();
    expect(screen.queryByText('rapiAvatar.mode.cleanup')).toBeNull();
    expect(screen.queryByText('rapiAvatar.mode.bulk')).toBeNull();
  });

  // Five tabs off a task, six on one: the conversation tab joined them on
  // 2026-10-22, which is also what let the greeting stop appearing above
  // every list.
  it.each([
    ['off a task', '/dashboard', '', 5],
    ['on a task', '/tasks/42', '', 6],
  ])('shows %s exactly %i tabs', (_label, path, query, expected) => {
    pathname = path;
    search = query;
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    // Counted by accessible name, not by text: only the tab you are in
    // shows its label now, the rest are their glyph plus a tooltip.
    const tabs = Array.from(document.querySelectorAll('[data-rapi-mode-tab]'));
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
    // It opens on the conversation; the point is that a sentence moves it.
    expect(screen.getByLabelText('rapiAvatar.mode.chat').getAttribute('aria-pressed')).toBe('true');

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
    expect(screen.getByLabelText('rapiAvatar.mode.chat').getAttribute('aria-pressed')).toBe('true');
  });
});

/**
 * Closing her is not cancelling her.
 *
 * The panel used to be unmounted on close, which threw away two different
 * things: what was typed or chosen, and any request still in flight. A
 * roadmap draft takes tens of seconds; closing the bubble while it thought
 * discarded the answer, with no way back except asking again.
 */
describe('closing and reopening', () => {
  /** Resolved by the test, so a request can still be in flight on close. */
  let release: (() => void) | null = null;

  const serve = (answer: Record<string, unknown>, hold = false) =>
    vi.stubGlobal('fetch', (url: string) => {
      if (hold && String(url).includes('/assistant/supervision')) {
        return new Promise((resolve) => {
          release = () =>
            resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) } as Response);
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(answer),
      } as Response);
    });

  afterEach(() => {
    release = null;
    vi.unstubAllGlobals();
  });

  const reopen = () => {
    fireEvent.click(avatarButton());
    fireEvent.click(avatarButton());
  };

  it('keeps the tab you were on', () => {
    serve({ total: 0, categories: [] });
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    fireEvent.click(screen.getByLabelText('rapiAvatar.mode.create'));
    expect(screen.getByText('rapiAvatar.intake.title')).toBeTruthy();

    reopen();
    expect(screen.getByText('rapiAvatar.intake.title')).toBeTruthy();
  });

  it('keeps what was typed at her', () => {
    serve({ total: 0, categories: [] });
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const box = screen.getByLabelText('rapiAvatar.prompt.label');
    fireEvent.change(box, { target: { value: '書きかけの文' } });

    reopen();
    expect((screen.getByLabelText('rapiAvatar.prompt.label') as HTMLTextAreaElement).value).toBe(
      '書きかけの文',
    );
  });

  // The expensive half. Work started before the close has to finish, and
  // its answer has to be there on the way back in.
  it('finishes work that was still running when it closed', async () => {
    serve({ total: 7, categories: [{ category: 'blocked', total: 7, tasks: [] }] }, true);
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    // The survey is a tab away now that the panel opens on the conversation,
    // and it is the survey's request this test suspends.
    fireEvent.click(screen.getByLabelText('rapiAvatar.mode.watch'));
    await waitFor(() => expect(release).not.toBeNull());

    // Shut while it is still thinking, then let the answer land.
    fireEvent.click(avatarButton());
    release!();

    fireEvent.click(avatarButton());
    await waitFor(() => expect(screen.getByText('rapiAvatar.watch.needHand:7')).toBeTruthy());
  });

  // Opening costs nothing now that the conversation is the first tab — the
  // survey's request waits until that tab is pressed. Doing any of it before
  // she has been opened would spend a request on every page load.
  it('asks for nothing until it is first opened', () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(String(url));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    });
    render(<RapiAvatarHost />);
    expect(calls).toEqual([]);
  });

  // The element must NOT be replaced — that is what keeps the typed text,
  // the chosen tab and the request in flight. `SpeechBubble`'s `speakKey`
  // would replay the entrance by replacing it, which is why it is not used
  // here, and this pins that: re-keying the bubble to "fix" the animation
  // would silently take the state preservation back out.
  it('reuses the same panel rather than building a new one', () => {
    serve({ total: 0, categories: [] });
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const first = screen.getByRole('dialog');
    reopen();
    expect(screen.getByRole('dialog')).toBe(first);
  });

  // So the entrance is restarted in place instead: cleared, reflowed, put
  // back. Clearing it and forgetting to restore would leave her arriving
  // with no animation at all, which jsdom can see even though the restart
  // itself can only be measured in a browser.
  it('still carries its entrance after reopening', () => {
    serve({ total: 0, categories: [] });
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    reopen();
    expect(screen.getByRole('dialog').style.animation).toContain('rapi-speak');
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

/**
 * Where ラピ is not.
 *
 * Reported 2026-10-29: she stood in the corner of the sign-in page. Nothing
 * she offers is reachable before signing in — resuming an execution, filing a
 * task, the survey — and the corner is the app's, not the login form's. Gated
 * ahead of her hooks, so the page does not spend a request fetching
 * executions no one can act on.
 */
describe('the sign-in page', () => {
  it('renders nothing on /auth/login', () => {
    pathname = '/auth/login';
    render(<RapiAvatarHost />);
    expect(avatarButton()).toBeNull();
  });

  it('does not even ask what can be resumed there', () => {
    pathname = '/auth/login';
    render(<RapiAvatarHost />);
    expect(resumableCalls).toBe(0);
  });

  it('is still there on an app page', () => {
    render(<RapiAvatarHost />);
    expect(avatarButton()).toBeTruthy();
    expect(resumableCalls).toBeGreaterThan(0);
  });
});
