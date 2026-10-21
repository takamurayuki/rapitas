/**
 * RapiAvatarLayout.test
 *
 * The shape of the panel, as asked for on 2026-10-21: the composer at the
 * bottom rather than above the content, one row of tabs instead of two, and
 * a greeting where her own name used to be.
 *
 * Measured in the live 320px bubble before changing anything — a 30px
 * single-line box above the list, and four text tabs wrapping onto two rows
 * for 49px of height before a word of content.
 *
 * Split from RapiAvatarHost.test.tsx, which went past the 500-line hard
 * limit when this suite was added.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

describe('what the panel looks like when it opens', () => {
  /** The scrolling middle — everything that is not header, tabs or composer. */
  const scroller = () => document.querySelector('.overflow-y-auto');

  it('does not label itself 「ラピ」 above her own speech bubble', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.queryByText('rapiAvatar.title')).toBeNull();
  });

  it('introduces itself once, before anything has been asked', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(screen.getByText('rapiAvatar.greeting')).toBeTruthy();
  });

  it('opens on the conversation tab', () => {
    // Everything else on the bar is a form or a list; this is the one that
    // answers a sentence, and it is what the box below is for.
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const chat = screen.getByLabelText('rapiAvatar.mode.chat');
    expect(chat.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the introduction to the conversation tab', () => {
    // It is the conversation's own prompt - it tells you to write in the box
    // below. On a list of overdue tasks it is just taking the first two
    // lines of the answer (reported 2026-10-22).
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    fireEvent.click(screen.getByLabelText('rapiAvatar.mode.create'));
    expect(screen.queryByText('rapiAvatar.greeting')).toBeNull();
  });

  it('puts the box at the bottom, outside the part that scrolls', () => {
    // It sat above the content, where a single line shrank against the list
    // below it and read as a search field.
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const box = screen.getByRole('textbox');
    expect(scroller()?.contains(box)).toBe(false);
    const boxIsAfter = !!(
      scroller()!.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(boxIsAfter).toBe(true);
  });

  it('keeps the tabs on one row, labelling only the one you are in', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const tabs = Array.from(document.querySelectorAll('[data-rapi-mode-tab]'));
    const labelled = tabs.filter((t) => (t.textContent ?? '').trim().length > 0);
    expect(tabs.length).toBeGreaterThan(1);
    expect(labelled).toHaveLength(1);
    expect(labelled[0]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('still names every tab for a screen reader and a tooltip', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const tabs = Array.from(document.querySelectorAll('[data-rapi-mode-tab]'));
    expect(
      tabs.every((t) => (t.getAttribute('aria-label') ?? '').startsWith('rapiAvatar.mode.')),
    ).toBe(true);
    expect(tabs.every((t) => !!t.getAttribute('title'))).toBe(true);
  });
});
