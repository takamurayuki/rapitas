/**
 * TaskNoteSplitView.test
 *
 * Opening a note replaces the task detail SLIDE PANEL with this full-page
 * split. Reported 2026-10-19: doing so made the task detail's title header
 * disappear — the left pane had a header bar and the right one had none, so
 * the 「タスク詳細」 bar the slide panel carries was simply gone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
vi.mock('@/stores/note-store', () => ({
  useNoteStore: (selector: (s: unknown) => unknown) =>
    selector({
      notes: [{ id: 'n1', title: 'メモ', content: '<p>x</p>' }],
    }),
}));

import { TaskNoteSplitView } from './TaskNoteSplitView';

beforeEach(() => back.mockReset());

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
