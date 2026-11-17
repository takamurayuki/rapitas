/**
 * NoteLinksSection.preview.test
 *
 * The task detail's linked-note rows show the first words of the body. A
 * Markdown note (one saved from ラピ's reply) used to preview as
 * "## 質問 ..." with its marks; the preview reads as plain words now, and a
 * note written in the rich editor previews without its tags as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useNoteStore, type Note } from '@/stores/note-store';
import NoteLinksSection from '../NoteLinksSection';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

function linked(id: string, content: string): Note {
  const now = new Date('2026-11-17T00:00:00Z');
  return {
    id,
    title: id,
    content,
    createdAt: now,
    updatedAt: now,
    isPinned: false,
    tags: [],
    linkedTaskIds: [7],
  };
}

describe('linked note previews', () => {
  it('reads a Markdown body as plain words and an editor body without tags', () => {
    useNoteStore.setState({
      notes: [
        linked('md', '## 質問\n\n**何**を使う?\n\n## ラピの回答\n\n- 一つ目\n'),
        linked('html', '<h2>見出し</h2><p>本文</p>'),
      ],
    });
    render(<NoteLinksSection taskId={7} />);
    expect(screen.getByText('質問 何を使う? ラピの回答 一つ目')).toBeTruthy();
    expect(screen.getByText('見出し本文')).toBeTruthy();
  });
});
