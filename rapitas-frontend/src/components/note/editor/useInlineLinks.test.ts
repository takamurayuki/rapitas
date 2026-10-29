/**
 * useInlineLinks.test
 *
 * Pasting a URL over selected words, following a link while editing, and
 * taking a link back off — the three things the feature exists for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const openExternalLink = vi.fn();
vi.mock('@/utils/external-links', () => ({
  openExternalLink: (url: string) => openExternalLink(url),
}));

import { useInlineLinks } from './useInlineLinks';
import { createInlineLink } from './inline-link';

const onContentChange = vi.fn();

beforeEach(() => {
  openExternalLink.mockReset();
  onContentChange.mockReset();
  document.body.innerHTML = '';
});

/** An editor holding one paragraph, plus the hook wired to it. */
function editorWith(html: string) {
  const content = document.createElement('div');
  content.contentEditable = 'true';
  content.innerHTML = html;
  document.body.append(content);

  const ref = { current: content };
  const { result } = renderHook(() => useInlineLinks(ref, onContentChange));
  return { content, result };
}

/** Select characters [start, end) of the paragraph's first text node. */
function select(content: HTMLElement, start: number, end: number) {
  const text = content.querySelector('p')!.firstChild as Text;
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** A paste event carrying `text` on the clipboard. */
function pasteEvent(text: string) {
  return {
    clipboardData: { getData: () => text },
    preventDefault: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('pasting a URL', () => {
  // The reported want: select words, paste a link, the words become blue
  // and underlined and go somewhere.
  it('turns the selected words into a link', () => {
    const { content, result } = editorWith('<p>read the docs now</p>');
    select(content, 5, 13);

    const event = pasteEvent('https://example.com/docs');
    act(() => result.current.onPaste(event));

    const anchor = content.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/docs');
    expect(anchor?.textContent).toBe('the docs');
    expect(content.textContent).toBe('read the docs now');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onContentChange).toHaveBeenCalled();
  });

  it('draws it blue and underlined', () => {
    const { content, result } = editorWith('<p>read the docs now</p>');
    select(content, 5, 13);
    act(() => result.current.onPaste(pasteEvent('https://example.com')));

    const anchor = content.querySelector('a')!;
    expect(anchor.style.textDecoration).toContain('underline');
    expect(anchor.style.color).toBeTruthy();
  });

  it('drops a bare URL in as a link to itself', () => {
    const { content, result } = editorWith('<p>here: </p>');
    select(content, 6, 6);
    act(() => result.current.onPaste(pasteEvent('https://example.com/docs')));

    const anchor = content.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/docs');
    expect(anchor?.textContent).toBe('https://example.com/docs');
  });

  // Ordinary text must paste as text; only a lone URL is special.
  it('leaves an ordinary paste alone', () => {
    const { content, result } = editorWith('<p>read the docs now</p>');
    select(content, 5, 13);

    const event = pasteEvent('some replacement words');
    act(() => result.current.onPaste(event));

    expect(content.querySelector('a')).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onContentChange).not.toHaveBeenCalled();
  });

  it('refuses a scheme that is not http(s)', () => {
    const { content, result } = editorWith('<p>read the docs now</p>');
    select(content, 5, 13);

    const event = pasteEvent('javascript:alert(1)');
    act(() => result.current.onPaste(event));

    expect(content.querySelector('a')).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores a paste outside the editor', () => {
    const { content, result } = editorWith('<p>read the docs now</p>');
    const outside = document.createElement('p');
    outside.textContent = 'elsewhere';
    document.body.append(outside);

    const range = document.createRange();
    range.selectNodeContents(outside);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const event = pasteEvent('https://example.com');
    act(() => result.current.onPaste(event));

    expect(content.querySelector('a')).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('following a link while editing', () => {
  /** A click event on the anchor inside `content`. */
  function clickOn(content: HTMLElement, modifier: boolean) {
    return {
      target: content.querySelector('a'),
      ctrlKey: modifier,
      metaKey: false,
      preventDefault: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  /** An editor already holding one inline link. */
  function withLink() {
    const made = editorWith('<p></p>');
    made.content.querySelector('p')!.append(createInlineLink('https://example.com', 'the docs'));
    return made;
  }

  // A plain click has to reach the caret: this is an editor, and the words
  // inside a link still need correcting.
  it('leaves a plain click to the caret', () => {
    const { content, result } = withLink();
    const event = clickOn(content, false);
    act(() => result.current.onClick(event));
    expect(openExternalLink).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('follows the link on Ctrl+click', () => {
    const { content, result } = withLink();
    const event = clickOn(content, true);
    act(() => result.current.onClick(event));
    expect(openExternalLink).toHaveBeenCalledWith('https://example.com/');
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe('the hover panel', () => {
  /** An editor holding one inline link, with the panel open on it. */
  function withPanel() {
    const made = editorWith('<p>before </p>');
    const anchor = createInlineLink('https://example.com', 'the docs');
    made.content.querySelector('p')!.append(anchor);
    act(() =>
      made.result.current.onMouseOver({
        target: anchor,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    );
    return made;
  }

  it('opens on the link under the pointer', () => {
    const { result } = withPanel();
    expect(result.current.popup?.url).toBe('https://example.com/');
  });

  it('stays shut over ordinary text', () => {
    const { content, result } = editorWith('<p>just words</p>');
    act(() =>
      result.current.onMouseOver({
        target: content.querySelector('p'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    );
    expect(result.current.popup).toBeNull();
  });

  // The answer to "how do I take the link off": the words stay, the link
  // goes.
  it('removes the link and keeps the words', () => {
    const { content, result } = withPanel();
    act(() => result.current.removePopupLink());

    expect(content.querySelector('a')).toBeNull();
    expect(content.textContent).toBe('before the docs');
    expect(result.current.popup).toBeNull();
    expect(onContentChange).toHaveBeenCalled();
  });

  it('re-points the link at a new URL', () => {
    const { content, result } = withPanel();
    act(() => result.current.retargetPopupLink('https://other.example/page'));

    expect(content.querySelector('a')?.getAttribute('href')).toBe('https://other.example/page');
    expect(content.querySelector('a')?.textContent).toBe('the docs');
    expect(onContentChange).toHaveBeenCalled();
  });

  it('refuses to re-point at something that is not a web URL', () => {
    const { content, result } = withPanel();
    act(() => result.current.retargetPopupLink('javascript:alert(1)'));
    expect(content.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });

  it('opens the link from the panel', () => {
    const { result } = withPanel();
    act(() => result.current.openPopupLink());
    expect(openExternalLink).toHaveBeenCalledWith('https://example.com/');
    expect(result.current.popup).toBeNull();
  });

  it('closes when dismissed', () => {
    const { result } = withPanel();
    act(() => result.current.dismissPopup());
    expect(result.current.popup).toBeNull();
  });
});

/**
 * Hover alone would leave keyboard users with no way to remove a link, so
 * the panel also follows the caret.
 */
describe('reaching the panel from the keyboard', () => {
  /** An editor whose caret sits inside an inline link. */
  function caretInLink() {
    const made = editorWith('<p>before </p>');
    const anchor = createInlineLink('https://example.com', 'the docs');
    made.content.querySelector('p')!.append(anchor);

    const range = document.createRange();
    range.setStart(anchor.firstChild as Text, 2);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return made;
  }

  it('opens when the caret lands inside a link', () => {
    const { result } = caretInLink();
    act(() => result.current.onCaretMoved());
    expect(result.current.popup?.url).toBe('https://example.com/');
  });

  it('closes when the caret leaves', () => {
    const { content, result } = caretInLink();
    act(() => result.current.onCaretMoved());
    expect(result.current.popup).not.toBeNull();

    const range = document.createRange();
    range.setStart(content.querySelector('p')!.firstChild as Text, 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => result.current.onCaretMoved());
    expect(result.current.popup).toBeNull();
  });

  it('stays shut when the caret is nowhere near a link', () => {
    const { result } = editorWith('<p>just words</p>');
    act(() => result.current.onCaretMoved());
    expect(result.current.popup).toBeNull();
  });
});
