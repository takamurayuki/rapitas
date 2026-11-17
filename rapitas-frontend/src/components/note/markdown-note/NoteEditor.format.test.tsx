/**
 * NoteEditor.format.test
 *
 * NoteEditor is the one body surface behind both the /notes page and the
 * task detail's note split view. A Markdown note must come out rendered by
 * MarkdownView; a note written in the desktop rich editor (HTML) must still
 * open in the contentEditable editor it was written in.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Note } from '@/stores/note-store';
import NoteEditor from '../NoteEditor';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock('mermaid', () => ({
  default: { initialize: () => {}, render: async () => ({ svg: '<svg></svg>' }) },
}));

function makeNote(id: string, content: string): Note {
  const now = new Date('2026-11-17T00:00:00Z');
  return { id, title: 't', content, createdAt: now, updatedAt: now, isPinned: false, tags: [] };
}

const MARKDOWN = '## 質問\n\n何?\n\n## ラピの回答\n\n- a\n- b\n';
const EDITOR_HTML = '<h2>見出し</h2><p>本文</p>';

describe('NoteEditor picks the surface by the body format', () => {
  it('renders a Markdown note through MarkdownView', () => {
    const { container } = render(<NoteEditor note={makeNote('m', MARKDOWN)} />);
    expect(container.querySelector('[data-density="note"] h2')?.textContent).toBe('質問');
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });

  it('keeps a rich editor note in the contentEditable editor', () => {
    const { container } = render(<NoteEditor note={makeNote('h', EDITOR_HTML)} />);
    expect(container.querySelector('[contenteditable]')).not.toBeNull();
    expect(container.querySelector('[data-density="note"]')).toBeNull();
  });

  it('switches surface when another note is opened in the same editor', () => {
    const { container, rerender } = render(<NoteEditor note={makeNote('h', EDITOR_HTML)} />);
    rerender(<NoteEditor note={makeNote('m', MARKDOWN)} />);
    expect(container.querySelector('[data-density="note"]')).not.toBeNull();
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });
});
