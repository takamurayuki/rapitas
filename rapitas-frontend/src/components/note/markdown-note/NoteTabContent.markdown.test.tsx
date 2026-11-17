/**
 * NoteTabContent.markdown.test
 *
 * The /notes page body (NoteTabContent → NoteEditor) shows a Markdown note
 * rendered by MarkdownView — a note saved from ラピ's reply used to show here
 * as one run of raw text with its `##` and `|` marks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useNoteStore, type Note } from '@/stores/note-store';
import NoteTabContent from '../note-tab-content';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock('mermaid', () => ({
  default: { initialize: () => {}, render: async () => ({ svg: '<svg></svg>' }) },
}));

describe('the /notes body', () => {
  it('renders a Markdown note through MarkdownView', () => {
    const now = new Date('2026-11-17T00:00:00Z');
    const note: Note = {
      id: 'n1',
      title: 'ラピとの会話',
      content: '## 質問\n\n何?\n\n## ラピの回答\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n',
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      tags: [],
    };
    useNoteStore.setState({ notes: [note], currentNoteId: 'n1' });
    const { container } = render(<NoteTabContent currentNote={note} onCreateNote={() => {}} />);
    const view = container.querySelector('[data-density="note"]');
    expect(view?.querySelectorAll('h2')).toHaveLength(2);
    expect(view?.querySelectorAll('table td')).toHaveLength(2);
    expect(view?.textContent).not.toContain('| --- |');
  });
});
