/**
 * WysiwygNoteSurface.test
 *
 * The visual surface reports an edit only when the user changes something,
 * pastes plain text (never outside HTML), writes itself back a moment after
 * an edit, and never loses a pending write when asked to flush or unmounted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import WysiwygNoteSurface, { type WysiwygSurfaceHandle } from './WysiwygNoteSurface';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

function mount(initialHtml: string) {
  const onEdit = vi.fn();
  const onMarkdown = vi.fn();
  const handleRef = createRef<WysiwygSurfaceHandle | null>() as {
    current: WysiwygSurfaceHandle | null;
  };
  const view = render(
    <WysiwygNoteSurface
      initialHtml={initialHtml}
      onEdit={onEdit}
      onMarkdown={onMarkdown}
      handleRef={handleRef}
    />,
  );
  const surface = screen.getByRole('textbox', { name: 'notes.markdownNote.surfaceLabel' });
  return { ...view, onEdit, onMarkdown, handleRef, surface };
}

function caretAtEnd(el: Node) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

function paste(target: HTMLElement, text: string) {
  fireEvent.paste(target, {
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '<b>x</b>') },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// NOTE: each test mounts the surface with its toolbar and table handles and
// takes 40–850ms on an idle machine. Run on the same host as the backend and
// the gate's own test run (see vitest.config.ts), single tests went past
// Vitest's 5000ms default with no assertion failing; this limit gives that
// room without hiding a real hang.
const RENDER_TEST_TIMEOUT_MS = 20_000;

describe('WysiwygNoteSurface', { timeout: RENDER_TEST_TIMEOUT_MS }, () => {
  it('starts from the given HTML and reports nothing until the user edits', () => {
    const { surface, onEdit, onMarkdown } = mount('<p>本文</p>');
    expect(surface.innerHTML).toBe('<p>本文</p>');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onEdit).not.toHaveBeenCalled();
    expect(onMarkdown).not.toHaveBeenCalled();
  });

  it('writes the surface back 200ms after an edit, once', () => {
    const { surface, onEdit, onMarkdown } = mount('<p>本文</p>');
    (surface.querySelector('p') as HTMLElement).textContent = '一';
    fireEvent.input(surface);
    (surface.querySelector('p') as HTMLElement).textContent = '二';
    fireEvent.input(surface);
    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(onMarkdown).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onMarkdown).toHaveBeenCalledTimes(1);
    expect(onMarkdown).toHaveBeenCalledWith('二');
  });

  it('flushes a pending write on request and returns the Markdown', () => {
    const { surface, onMarkdown, handleRef } = mount('<p>本文</p>');
    (surface.querySelector('p') as HTMLElement).textContent = '**ではない**';
    fireEvent.input(surface);
    // Marks typed as words are escaped, so the saved note is not bold.
    expect(handleRef.current?.flush()).toBe(String.raw`\*\*ではない\*\*`);
    expect(onMarkdown).toHaveBeenLastCalledWith(String.raw`\*\*ではない\*\*`);
  });

  it('keeps the line breaks of pasted text', () => {
    const { surface, handleRef } = mount('<p>前</p>');
    caretAtEnd(surface.querySelector('p') as Node);
    paste(surface, '一行目\n二行目\r\n三行目');
    expect(surface.querySelectorAll('p br')).toHaveLength(2);
    expect(handleRef.current?.flush()).toBe('前一行目\n二行目\n三行目');
  });

  it('does not lose a pending write when it unmounts', () => {
    const { surface, onMarkdown, unmount } = mount('<p>本文</p>');
    (surface.querySelector('p') as HTMLElement).textContent = '閉じる前';
    fireEvent.input(surface);
    unmount();
    expect(onMarkdown).toHaveBeenLastCalledWith('閉じる前');
  });

  it('pastes text as text, not the clipboard HTML', () => {
    const { surface, onEdit } = mount('<p>前</p>');
    caretAtEnd(surface.querySelector('p') as Node);
    paste(surface, '<script>x</script>後');
    expect(surface.querySelector('script')).toBeNull();
    expect(surface.querySelector('b')).toBeNull();
    expect(surface.textContent).toBe('前<script>x</script>後');
    expect(onEdit).toHaveBeenCalled();
  });

  it('pastes a lone URL as a link', () => {
    const { surface } = mount('<p>前</p>');
    caretAtEnd(surface.querySelector('p') as Node);
    paste(surface, 'https://example.com');
    expect(surface.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });

  it('counts a checklist tick as an edit', () => {
    const { surface, onEdit, handleRef } = mount('<ul><li><input type="checkbox"> 項目</li></ul>');
    fireEvent.click(surface.querySelector('input') as HTMLInputElement);
    expect(onEdit).toHaveBeenCalled();
    expect(handleRef.current?.flush()).toBe('- [x] 項目');
  });
});
