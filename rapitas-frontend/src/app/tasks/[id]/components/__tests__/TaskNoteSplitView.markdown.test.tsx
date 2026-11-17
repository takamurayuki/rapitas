/**
 * TaskNoteSplitView.markdown.test
 *
 * The task detail's note pane shows a Markdown note (for example one saved
 * from ラピ's reply and linked to the task) rendered, not as raw text: the
 * real NoteEditor is used here, unlike TaskNoteSplitView.test which stubs it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock('mermaid', () => ({
  default: {
    initialize: () => {},
    render: async () => ({ svg: '<svg data-mermaid-mock="true"></svg>' }),
  },
}));
vi.mock('../../TaskDetailClient', () => ({
  default: () => <div data-testid="task-detail" />,
}));
vi.mock('@/stores/task-detail-visibility-store', () => ({
  useTaskDetailVisibilityStore: (selector: (s: unknown) => unknown) =>
    selector({ dockSide: 'right', toggleDockSide: vi.fn() }),
}));

const CONTENT = vi.hoisted(() =>
  [
    '## ラピの回答',
    '',
    '- 一つ目',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```mermaid',
    'flowchart TD',
    '  A-->B',
    '```',
    '',
  ].join('\n'),
);

vi.mock('@/stores/note-store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const now = new Date('2026-11-17T00:00:00Z');
  const state = {
    notes: [
      {
        id: 'n1',
        title: 'メモ',
        content: CONTENT,
        createdAt: now,
        updatedAt: now,
        isPinned: false,
        tags: [],
      },
    ],
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    setCurrentNote: vi.fn(),
  };
  return { ...actual, useNoteStore: (selector: (s: unknown) => unknown) => selector(state) };
});

import { TaskNoteSplitView } from '../TaskNoteSplitView';

describe('the note pane', () => {
  it('renders a Markdown note through MarkdownView, with its diagram drawn', async () => {
    const { container } = render(<TaskNoteSplitView taskId={1} noteId="n1" />);
    const view = container.querySelector('[data-density="note"]');
    expect(view?.querySelector('h2')?.textContent).toBe('ラピの回答');
    expect(view?.querySelector('ul li')?.textContent).toBe('一つ目');
    expect(view?.querySelectorAll('table td')).toHaveLength(2);
    expect(container.querySelector('[contenteditable]')).toBeNull();
    await waitFor(() => {
      expect(view?.querySelector('[data-mermaid-mock]')).not.toBeNull();
    });
  });
});
