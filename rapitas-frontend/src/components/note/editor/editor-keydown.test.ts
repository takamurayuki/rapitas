/**
 * editor-keydown.test
 *
 * Composition-safety tests for the keydown dispatcher: keys pressed while an
 * IME composition is active (isComposing / legacy keyCode 229) must be left
 * entirely to the IME — no heading exit, no span continuation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type React from 'react';
import { handleEditorKeyDown } from './editor-keydown';
import type { EditorRefs } from './editor-keydown.types';

let contentEl: HTMLDivElement;
let refs: EditorRefs;

/** Places a collapsed caret at (node, offset). */
function setCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Builds a minimal keydown event with controllable composition state. */
function makeKeyEvent(key: string, opts: { isComposing?: boolean; keyCode?: number } = {}) {
  return {
    key,
    shiftKey: false,
    keyCode: opts.keyCode ?? 0,
    nativeEvent: { isComposing: opts.isComposing ?? false },
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent<HTMLDivElement> & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  contentEl = document.createElement('div');
  contentEl.contentEditable = 'true';
  document.body.appendChild(contentEl);
  refs = {
    contentRef: { current: contentEl },
    activeColorSpanRef: { current: null },
    selectedTextColorRef: { current: null },
    isComposingRef: { current: false },
  };
});

afterEach(() => {
  contentEl.remove();
  window.getSelection()?.removeAllRanges();
});

describe('handleEditorKeyDown — IME composition guard', () => {
  it('ignores Enter at a heading end while composing (no paragraph exit)', () => {
    contentEl.innerHTML = '<h2>見出し</h2>';
    setCaret(contentEl.querySelector('h2')!.firstChild!, 3);

    const e = makeKeyEvent('Enter', { isComposing: true });
    handleEditorKeyDown(e, refs, () => {});

    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(contentEl.querySelector('p')).toBeNull();
    expect(contentEl.innerHTML).toBe('<h2>見出し</h2>');
  });

  it('ignores keys reported via legacy keyCode 229', () => {
    contentEl.innerHTML = '<h2>見出し</h2>';
    setCaret(contentEl.querySelector('h2')!.firstChild!, 3);

    const e = makeKeyEvent('Enter', { keyCode: 229 });
    handleEditorKeyDown(e, refs, () => {});

    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(contentEl.innerHTML).toBe('<h2>見出し</h2>');
  });

  it('ignores Enter inside a styled span while composing (no continuation split)', () => {
    contentEl.innerHTML = '<span style="font-family: Georgia, serif">abc</span>';
    setCaret(contentEl.querySelector('span')!.firstChild!, 3);

    const e = makeKeyEvent('Enter', { isComposing: true });
    handleEditorKeyDown(e, refs, () => {});

    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(contentEl.querySelectorAll('span')).toHaveLength(1);
    expect(contentEl.querySelector('br')).toBeNull();
  });

  it('still handles Enter at a heading end when not composing', () => {
    contentEl.innerHTML = '<h2>見出し</h2>';
    setCaret(contentEl.querySelector('h2')!.firstChild!, 3);

    const e = makeKeyEvent('Enter');
    handleEditorKeyDown(e, refs, () => {});

    expect(e.preventDefault).toHaveBeenCalled();
    expect(contentEl.querySelector('h2 + p')).not.toBeNull();
  });
});
