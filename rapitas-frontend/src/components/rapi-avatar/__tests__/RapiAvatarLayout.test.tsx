/**
 * RapiAvatarLayout.test
 *
 * The shape of the panel, as asked for on 2026-10-21: the composer at the
 * bottom rather than above the content, no tab bar (2026-11-14), and
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
vi.mock('../state/useRapiAvatarState', () => ({
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
  /** The scrolling middle — everything that is not header or composer. */
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

  it('opens on the conversation', () => {
    // The conversation is the only place with nothing above it: every other
    // mode carries a header saying where you are and the way back.
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    expect(document.querySelector('[data-rapi-mode-header]')).toBeNull();
  });

  it('keeps the introduction to the conversation', async () => {
    // It is the conversation's own prompt - it tells you to write in the box
    // below. On a list of overdue tasks it is just taking the first two
    // lines of the answer (reported 2026-10-22).
    vi.stubGlobal('fetch', (url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            String(url).includes('/assistant/route')
              ? { routed: true, intent: 'create', reason: '' }
              : {},
          ),
      } as Response),
    );
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'タスクを作って' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(document.querySelector('[data-rapi-mode-header]')).not.toBeNull());
    expect(screen.queryByText('rapiAvatar.greeting')).toBeNull();
    vi.unstubAllGlobals();
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

  // Reported 2026-11-14: the box was too narrow to write a request in. A
  // single 12px line read as a search field; it is three lines of 14px now.
  it('gives the box room for a sentence or two before anything is typed', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.rows).toBeGreaterThanOrEqual(3);
    expect(parseInt(box.style.minHeight, 10)).toBeGreaterThanOrEqual(72);
    expect(box.className).toContain('text-sm');
  });

  it('can be sent with a button as well as with Enter, once there is something to send', () => {
    render(<RapiAvatarHost />);
    fireEvent.click(avatarButton());
    const send = screen.getByLabelText('rapiAvatar.prompt.send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'なにか' } });
    expect(send.disabled).toBe(false);
  });
});
