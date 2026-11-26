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
  // The local store: these cases are about the editor, not the requests.
  useNoteStore.setState({ source: 'local', notes: [makeNote(SAMPLE)], currentNoteId: 'n1' });
});

// NOTE: these render the whole editor (header, MarkdownView, and in edit mode
// the visual surface and toolbar) and take 50–1300ms on an idle machine. The
// verifier runs the suite on the same host as the backend and its own gate run
// (see vitest.config.ts); under that load single tests went past Vitest's
// 5000ms default with no assertion failing. The limit gives that room without
// hiding a real hang.
const RENDER_TEST_TIMEOUT_MS = 20_000;

describe('MarkdownNoteEditor', { timeout: RENDER_TEST_TIMEOUT_MS }, () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.source' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.source' }));
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

  // Stage 0 (design §5.3): this editor is the only save path, so it is
  // where a new HTML body would get in — and where a plain line must not
  // be refused.
  it('saves a single plain line and an empty body', () => {
    render(<MarkdownNoteEditor note={makeNote(SAMPLE)} />);
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.source' }));
    const source = screen.getByRole('textbox', { name: 'notes.markdownNote.sourceLabel' });
    fireEvent.change(source, { target: { value: '牛乳を買う' } });
    fireEvent.click(screen.getByTitle('notes.editorHeader.saveTitle'));
    expect(useNoteStore.getState().notes.find((n) => n.id === 'n1')?.content).toBe('牛乳を買う');
    fireEvent.change(source, { target: { value: '' } });
    fireEvent.click(screen.getByTitle('notes.editorHeader.saveTitle'));
    expect(useNoteStore.getState().notes.find((n) => n.id === 'n1')?.content).toBe('');
  });

  it('refuses to save a body that is the old editor HTML', () => {
    render(<MarkdownNoteEditor note={makeNote(SAMPLE)} />);
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.source' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'notes.markdownNote.sourceLabel' }), {
      target: { value: '<div>本文</div><div><br></div>' },
    });
    fireEvent.click(screen.getByTitle('notes.editorHeader.saveTitle'));
    expect(useNoteStore.getState().notes.find((n) => n.id === 'n1')?.content).toBe(SAMPLE);
    expect(screen.getByRole('alert').textContent).toBe('notes.sync.legacy_html');
  });

  it('opens the visual editor without marking the note changed', () => {
    const updateNote = vi.spyOn(useNoteStore.getState(), 'updateNote');
    render(<MarkdownNoteEditor note={makeNote('* 星の箇条書き')} />);
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.edit' }));
    expect(screen.getByRole('textbox', { name: 'notes.markdownNote.surfaceLabel' })).toBeTruthy();
    // The writer would spell `*` as `-`; the user is told, nothing is saved.
    expect(screen.getByRole('status').textContent).toBe('notes.markdownNote.roundTripNotice');
    fireEvent.click(screen.getByTitle('notes.editorHeader.saveTitle'));
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.view' }));
    expect(updateNote).not.toHaveBeenCalled();
    expect(useNoteStore.getState().notes.find((n) => n.id === 'n1')?.content).toBe(SAMPLE);
    expect(screen.getByText('星の箇条書き')).toBeTruthy();
  });

  it('saves a colour picked on the visual surface as the allowed inline form', () => {
    render(<MarkdownNoteEditor note={makeNote('赤字')} />);
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.edit' }));
    const surface = screen.getByRole('textbox', { name: 'notes.markdownNote.surfaceLabel' });
    const text = surface.querySelector('p')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.toolbar.textColor' }));
    fireEvent.click(screen.getByRole('button', { name: '赤' }));
    fireEvent.click(screen.getByTitle('notes.editorHeader.saveTitle'));

    expect(useNoteStore.getState().notes.find((n) => n.id === 'n1')?.content).toBe(
      '<span style="color:#DC2626">赤字</span>',
    );
  });

  it('carries a visual edit into the source mode', () => {
    render(<MarkdownNoteEditor note={makeNote('本文')} />);
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.edit' }));
    const surface = screen.getByRole('textbox', { name: 'notes.markdownNote.surfaceLabel' });
    (surface.querySelector('p') as HTMLElement).textContent = '書き換えた本文';
    fireEvent.input(surface);
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.source' }));
    expect(
      (
        screen.getByRole('textbox', {
          name: 'notes.markdownNote.sourceLabel',
        }) as HTMLTextAreaElement
      ).value,
    ).toBe('書き換えた本文');
  });

  it('strips disallowed inline HTML from the source on save', () => {
    render(<MarkdownNoteEditor note={makeNote(SAMPLE)} />);
    fireEvent.click(screen.getByRole('button', { name: 'notes.markdownNote.source' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'notes.markdownNote.sourceLabel' }), {
      target: { value: '<span style="color:#E53935">赤</span><span onclick="x">z</span>' },
    });
    fireEvent.click(screen.getByTitle('notes.editorHeader.saveTitle'));
    expect(useNoteStore.getState().notes.find((n) => n.id === 'n1')?.content).toBe(
      '<span style="color:#E53935">赤</span>z',
    );
  });
});
