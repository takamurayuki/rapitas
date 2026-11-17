/**
 * MarkdownNoteEditor.test
 *
 * A Markdown note opens rendered (MarkdownView, note density) — headings,
 * lists, tables, code, links and a Mermaid diagram drawn as a diagram — and
 * is edited as its plain Markdown source, which is what gets saved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useNoteStore, type Note } from '@/stores/note-store';
import MarkdownNoteEditor from './MarkdownNoteEditor';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

const mermaid = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('mermaid', () => ({
  default: { initialize: () => {}, render: mermaid.render },
}));

const SAMPLE = [
  '## 質問',
  '',
  'ノートの書き方は?',
  '',
  '## ラピの回答',
  '',
  '- 見出しは ## と ###',
  '- 表とコードも使える',
  '',
  '| 項目 | 値 |',
  '| --- | --- |',
  '| 形式 | Markdown |',
  '',
  '```ts',
  'const ok = true;',
  '```',
  '',
  '[参考](https://example.com)',
  '',
  '```mermaid',
  'flowchart TD',
  '  A-->B',
  '```',
  '',
].join('\n');

function makeNote(content: string): Note {
  const now = new Date('2026-11-17T00:00:00Z');
  return {
    id: 'n1',
    title: 'ノートの書き方',
    content,
    createdAt: now,
    updatedAt: now,
    isPinned: false,
    tags: [],
  };
}

beforeEach(() => {
  mermaid.render.mockReset();
  mermaid.render.mockResolvedValue({ svg: '<svg data-mermaid-mock="true"></svg>' });
  useNoteStore.setState({ notes: [makeNote(SAMPLE)], currentNoteId: 'n1' });
});

describe('MarkdownNoteEditor', () => {
  it('renders the body through MarkdownView with the note density', () => {
    const { container } = render(<MarkdownNoteEditor note={makeNote(SAMPLE)} />);
    const view = container.querySelector('[data-density="note"]');
    expect(view).not.toBeNull();
    expect(view?.querySelectorAll('h2')).toHaveLength(2);
    expect(view?.querySelectorAll('ul li')).toHaveLength(2);
    expect(view?.querySelector('table td')?.textContent).toBe('形式');
    expect(view?.querySelector('pre code')?.textContent).toContain('const ok = true;');
    expect(view?.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    // No raw Markdown marks and no contentEditable surface.
    expect(view?.textContent).not.toContain('## 質問');
    expect(view?.textContent).not.toContain('| --- |');
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });

  it('draws a mermaid fence as a diagram, not as code', async () => {
    const { container } = render(<MarkdownNoteEditor note={makeNote(SAMPLE)} />);
    await waitFor(() => {
      expect(container.querySelector('[data-mermaid-mock]')).not.toBeNull();
    });
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), 'flowchart TD\n  A-->B');
  });

  it('edits the plain Markdown source and saves it unchanged in form', () => {
    render(<MarkdownNoteEditor note={makeNote(SAMPLE)} />);
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.edit' }));
    const source = screen.getByRole('textbox', { name: 'notes.markdownNote.sourceLabel' });
    expect((source as HTMLTextAreaElement).value).toBe(SAMPLE);

    fireEvent.change(source, { target: { value: '## 書き換え\n\n- 一つ\n' } });
    fireEvent.click(screen.getByTitle('notes.editorHeader.saveTitle'));

    const saved = useNoteStore.getState().notes.find((n) => n.id === 'n1');
    expect(saved?.content).toBe('## 書き換え\n\n- 一つ\n');
    expect(saved?.title).toBe('ノートの書き方');
  });

  it('shows the edited source rendered when switching back to the view', () => {
    const { container } = render(<MarkdownNoteEditor note={makeNote(SAMPLE)} />);
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'notes.markdownNote.sourceLabel' }), {
      target: { value: '### 小見出し' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.view' }));
    expect(container.querySelector('[data-density="note"] h3')?.textContent).toBe('小見出し');
  });

  it('says so when the body is empty', () => {
    render(<MarkdownNoteEditor note={makeNote('   ')} />);
    expect(screen.getByText('notes.markdownNote.empty')).toBeTruthy();
  });
});
