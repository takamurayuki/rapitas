/**
 * color-persistence.test
 *
 * IME-safety regression tests: input-event handling must not rewrite text
 * nodes while a composition is active (the 「テストt」 stray-romaji bug), the
 * deferred compositionend cleanup must keep the composed text inside the
 * font anchor span, and direct (non-IME) input must still clean per event.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type React from 'react';
import { applyFont } from './formatting';
import { handleEditorInput, runEditorCleanup } from './color-persistence';

const ZWSP = '​';

let contentEl: HTMLDivElement;
let refs: {
  contentRef: { current: HTMLDivElement | null };
  activeColorSpanRef: { current: HTMLSpanElement | null };
  selectedTextColorRef: { current: string | null };
  isComposingRef: { current: boolean };
};

/** Places a collapsed caret at (node, offset). */
function setCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Simulates the input event React dispatches after a DOM text change. */
function fireInput(): void {
  handleEditorInput(
    { target: contentEl } as unknown as React.FormEvent<HTMLDivElement>,
    refs,
    () => {},
  );
}

/**
 * Rewrites the anchor text node the way an IME composition update does:
 * pending text replaces the previous pending text after the ZWSP.
 */
function imeUpdate(anchorText: Text, pending: string): void {
  anchorText.textContent = ZWSP + pending;
  setCaret(anchorText, anchorText.textContent.length);
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

describe('IME composition inside a font anchor span (reported bug)', () => {
  it('never mutates the anchor text node while composing', () => {
    contentEl.textContent = 'before';
    setCaret(contentEl.firstChild!, 6);
    applyFont(contentEl, 'Georgia, serif');
    const span = contentEl.querySelector('span')!;
    const anchorText = span.firstChild as Text;

    refs.isComposingRef.current = true;

    // IME session: romaji appears, then converts (t → テ → テス → テスト).
    for (const pending of ['t', 'テ', 'テス', 'テスト']) {
      imeUpdate(anchorText, pending);
      fireInput();
      // The regression: cleanup used to strip the ZWSP mid-composition,
      // desyncing the IME so it re-inserted pending romaji (「テストt」).
      expect(anchorText.textContent).toBe(ZWSP + pending);
      expect(span.firstChild).toBe(anchorText);
    }
  });

  it('commits the composed text inside the font span after compositionend cleanup', () => {
    contentEl.textContent = 'before';
    setCaret(contentEl.firstChild!, 6);
    applyFont(contentEl, 'Georgia, serif');
    const span = contentEl.querySelector('span')!;
    const anchorText = span.firstChild as Text;

    refs.isComposingRef.current = true;
    imeUpdate(anchorText, 'テスト');
    fireInput();

    // compositionend: flag drops, one deferred cleanup pass runs.
    refs.isComposingRef.current = false;
    runEditorCleanup(refs);

    // No stray characters, composed string inherits the chosen font.
    expect(span.textContent).toBe('テスト');
    expect(span.style.fontFamily).toContain('Georgia');
    expect(contentEl.textContent).toBe('beforeテスト');

    // Caret stays inside the span so continued typing keeps the font.
    const range = window.getSelection()!.getRangeAt(0);
    expect(span.contains(range.startContainer)).toBe(true);
    expect(range.startOffset).toBe(3);
  });

  it('is idempotent — a duplicate cleanup pass (Safari trailing input) is a no-op', () => {
    contentEl.textContent = '';
    setCaret(contentEl, 0);
    applyFont(contentEl, 'Georgia, serif');
    const span = contentEl.querySelector('span')!;

    refs.isComposingRef.current = true;
    imeUpdate(span.firstChild as Text, 'テスト');
    refs.isComposingRef.current = false;

    runEditorCleanup(refs);
    const htmlAfterFirst = contentEl.innerHTML;
    runEditorCleanup(refs);
    fireInput();

    expect(contentEl.innerHTML).toBe(htmlAfterFirst);
    expect(span.textContent).toBe('テスト');
  });

  it('keeps the orphan-ZWSP sweep deferred too while composing', () => {
    // A stale anchor elsewhere must not be swept mid-composition either —
    // any DOM mutation can invalidate the IME's target range bookkeeping.
    contentEl.innerHTML = `<span style="font-family: Georgia, serif">${ZWSP}</span>plain`;
    setCaret(contentEl.lastChild!, 5);

    refs.isComposingRef.current = true;
    fireInput();
    expect(contentEl.querySelector('span')!.textContent).toBe(ZWSP);

    refs.isComposingRef.current = false;
    runEditorCleanup(refs);
    expect(contentEl.querySelector('span')!.textContent).toBe('');
  });
});

describe('direct (non-IME) input still cleans per event', () => {
  it('strips the anchor ZWSP immediately when not composing', () => {
    contentEl.textContent = '';
    setCaret(contentEl, 0);
    applyFont(contentEl, 'Georgia, serif');
    const span = contentEl.querySelector('span')!;
    const anchorText = span.firstChild as Text;

    anchorText.insertData(1, 'a');
    setCaret(anchorText, 2);
    fireInput();

    expect(span.textContent).toBe('a');
    const range = window.getSelection()!.getRangeAt(0);
    expect(span.contains(range.startContainer)).toBe(true);
  });

  it('works with refs that carry no composition flag (legacy callers)', () => {
    contentEl.textContent = '';
    setCaret(contentEl, 0);
    applyFont(contentEl, 'Georgia, serif');
    const span = contentEl.querySelector('span')!;
    const anchorText = span.firstChild as Text;
    anchorText.insertData(1, 'x');
    setCaret(anchorText, 2);

    handleEditorInput(
      { target: contentEl } as unknown as React.FormEvent<HTMLDivElement>,
      {
        contentRef: { current: contentEl },
        activeColorSpanRef: { current: null },
        selectedTextColorRef: { current: null },
      },
      () => {},
    );
    expect(span.textContent).toBe('x');
  });
});
