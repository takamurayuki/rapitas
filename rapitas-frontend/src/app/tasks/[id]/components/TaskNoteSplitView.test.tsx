/**
 * TaskNoteSplitView.test
 *
 * Opening a note replaces the task detail SLIDE PANEL with this full-page
 * split. Reported 2026-10-19: doing so made the task detail's title header
 * disappear — the left pane had a header bar and the right one had none, so
 * the 「タスク詳細」 bar the slide panel carries was simply gone.
 *
 * Reported again 2026-10-21: the heading came back but nothing else did. The
 * panel's header carries three controls and this one carried none, so there
 * was no way to put the task on the left or to close it from the task half.
 * Measured against the live panel before fixing — 3 buttons there, 0 here —
 * and the dock side is the panel's own persisted preference rather than a
 * second one, so "task on the left" means the same thing in both places.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const back = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ back }) }));
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock('@/components/note/NoteEditor', () => ({
  default: () => <div data-testid="note-editor" />,
}));
vi.mock('../TaskDetailClient', () => ({
  default: () => <div data-testid="task-detail" />,
}));
const toggleDockSide = vi.fn();
let dockSide: 'left' | 'right' = 'right';
vi.mock('@/stores/task-detail-visibility-store', () => ({
  useTaskDetailVisibilityStore: (selector: (s: unknown) => unknown) =>
    selector({ dockSide, toggleDockSide }),
}));
vi.mock('@/stores/note-store', () => ({
  useNoteStore: (selector: (s: unknown) => unknown) =>
    selector({
      notes: [{ id: 'n1', title: 'メモ', content: '<p>x</p>' }],
    }),
}));

import { TaskNoteSplitView } from './TaskNoteSplitView';

beforeEach(() => {
  back.mockReset();
  toggleDockSide.mockReset();
  dockSide = 'right';
});

/**
 * The panes in the order they are painted, left to right.
 *
 * Read off the flex `order` class rather than DOM position: the panes are
 * reordered with CSS precisely so that swapping sides does not remount the
 * editor and lose an unsaved caret, which means DOM order never changes.
 * jsdom loads no stylesheet, so the class is the only honest handle — that
 * it paints that way is checked in a browser instead.
 */
const paneOf = (testId: string) =>
  screen.getByTestId(testId).closest('[class*="order-"]')?.className ?? '';
const paneOrder = () => {
  const noteFirst = paneOf('note-editor').includes('order-1');
  return noteFirst ? ['note', 'task'] : ['task', 'note'];
};

const show = () => render(<TaskNoteSplitView taskId={1363} noteId="n1" />);

describe('the right pane', () => {
  // The defect. The slide panel this view replaces is headed 「タスク詳細」;
  // without it the right half had no heading at all.
  it('is headed, the way the slide panel it replaces is', () => {
    show();
    const heading = screen.getByRole('heading', { name: 'task.taskSlidePanel.title' });
    expect(heading).toBeTruthy();
  });

  it('uses the same translation key as the slide panel', () => {
    show();
    // `task.taskSlidePanel` + `title` — change either and the two headers
    // stop agreeing.
    expect(screen.getByText('task.taskSlidePanel.title')).toBeTruthy();
  });

  it('still shows the task detail', () => {
    show();
    expect(screen.getByTestId('task-detail')).toBeTruthy();
  });

  // The quick-nav resolves its scroller with closest(), so the marker has to
  // be on the element that actually scrolls — and the header must sit
  // OUTSIDE it, or it scrolls away with the content.
  it('scrolls below the header, not with it', () => {
    const { container } = show();
    const scroller = container.querySelector('[data-task-scroll-container]');
    expect(scroller).toBeTruthy();
    expect(scroller?.className).toContain('overflow-y-auto');
    expect(scroller?.contains(screen.getByTestId('task-detail'))).toBe(true);
    expect(
      scroller?.contains(screen.getByRole('heading', { name: 'task.taskSlidePanel.title' })),
    ).toBe(false);
  });
});

describe('the left pane', () => {
  it('still offers the way back', () => {
    show();
    expect(screen.getByText('task.noteSplitView.backToTask')).toBeTruthy();
  });

  it('still shows the note editor', () => {
    show();
    expect(screen.getByTestId('note-editor')).toBeTruthy();
  });
});

describe('the controls the slide panel has', () => {
  it('offers a close from the task half, not only from the note half', () => {
    show();
    const close = screen.getByLabelText('task.taskSlidePanel.closeAria');
    fireEvent.click(close);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('offers putting the task detail on the left', () => {
    show();
    fireEvent.click(screen.getByLabelText('task.taskSlidePanel.swapDockSideAria'));
    expect(toggleDockSide).toHaveBeenCalledTimes(1);
  });

  it('actually puts it there, rather than only remembering the preference', () => {
    dockSide = 'left';
    show();
    expect(paneOrder()).toEqual(['task', 'note']);
  });

  it('keeps the note on the left by default, as it has been', () => {
    show();
    expect(paneOrder()).toEqual(['note', 'task']);
  });

  it('heads both panes the way the panel heads itself — white, not grey', () => {
    // The colour cannot be read in jsdom, so the class that produces it is
    // what is pinned. It is the same class the slide panel's header uses.
    show();
    const heading = screen.getByText('task.taskSlidePanel.title');
    expect(heading.parentElement?.className).toContain('bg-white');
    const back = screen.getByText('task.noteSplitView.backToTask');
    expect(back.closest('div')?.className).toContain('bg-white');
  });
});
