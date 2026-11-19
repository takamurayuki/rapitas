/**
 * NoteEditor.format.test
 *
 * NoteEditor is the one body surface behind both the /notes page and the
 * task detail's note split view. Since stage 0 (design §5.3) every note —
 * including an empty or one-line one — opens in the Markdown editor, and a
 * note written in the old rich editor (HTML) opens read-only with
 * "Markdown に変換して編集". No path here edits or saves HTML.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useNoteStore, type Note } from '@/stores/note-store';
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
const EDITOR_HTML = '<h2>見出し</h2><p>本文の<strong>太字</strong></p><ul><li>一</li></ul>';

const updateNote = vi.fn();
beforeEach(() => {
  updateNote.mockReset();
  useNoteStore.setState({ updateNote });
});

describe('NoteEditor picks the surface by the body', () => {
  it('renders a Markdown note through MarkdownView', () => {
    const { container } = render(<NoteEditor note={makeNote('m', MARKDOWN)} />);
    expect(container.querySelector('[data-density="note"] h2')?.textContent).toBe('質問');
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });

  it('opens an empty note and a one-line note in the Markdown editor, not the rich editor', () => {
    for (const body of ['', '牛乳を買う']) {
      const { container, unmount } = render(<NoteEditor note={makeNote(`x${body}`, body)} />);
      expect(screen.getByText('notes.markdownNote.edit')).toBeTruthy();
      expect(container.querySelector('[contenteditable]')).toBeNull();
      expect(screen.queryByTestId('legacy-html-note')).toBeNull();
      unmount();
    }
  });

  it('shows a rich editor note read-only, with no editable surface', () => {
    const { container } = render(<NoteEditor note={makeNote('h', EDITOR_HTML)} />);
    expect(screen.getByTestId('legacy-html-note')).toBeTruthy();
    expect(container.querySelector('[contenteditable]')).toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('見出し');
    expect(screen.getByText('notes.legacyHtml.badge')).toBeTruthy();
  });

  it('converts to Markdown, shows the result, and saves only on confirm', () => {
    render(<NoteEditor note={makeNote('h', EDITOR_HTML)} />);
    fireEvent.click(screen.getByText('notes.legacyHtml.convert'));
    const source = screen.getByLabelText('notes.legacyHtml.sourceLabel') as HTMLTextAreaElement;
    expect(source.value).toBe('## 見出し\n\n本文の**太字**\n\n- 一');
    expect(updateNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('notes.legacyHtml.save'));
    expect(updateNote).toHaveBeenCalledWith('h', {
      content: '## 見出し\n\n本文の**太字**\n\n- 一',
    });
  });

  it('will not save a converted body that was edited back into HTML', () => {
    render(<NoteEditor note={makeNote('h', EDITOR_HTML)} />);
    fireEvent.click(screen.getByText('notes.legacyHtml.convert'));
    fireEvent.change(screen.getByLabelText('notes.legacyHtml.sourceLabel'), {
      target: { value: '<div>戻した</div>' },
    });
    fireEvent.click(screen.getByText('notes.legacyHtml.save'));
    expect(updateNote).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('notes.sync.legacy_html');
  });

  it('switches surface when another note is opened in the same editor', () => {
    const { container, rerender } = render(<NoteEditor note={makeNote('h', EDITOR_HTML)} />);
    rerender(<NoteEditor note={makeNote('m', MARKDOWN)} />);
    expect(container.querySelector('[data-density="note"]')).not.toBeNull();
    expect(screen.queryByTestId('legacy-html-note')).toBeNull();
  });
});
