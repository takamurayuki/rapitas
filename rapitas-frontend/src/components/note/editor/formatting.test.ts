/**
 * formatting.test
 *
 * Regression tests for the note editor's font handling: the reported
 * "picked font is dropped when typing starts" bug, caret-anchor behaviour,
 * format detection, and the save/load round-trip of font-family spans.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type React from 'react';
import DOMPurify from 'dompurify';
import { applyFont, applyFontSize, detectCurrentFormat } from './formatting';
import { handleEditorInput } from './color-persistence';
import { getContentWithoutDiagramSvg } from './diagram-block';

const ZWSP = '​';

let contentEl: HTMLDivElement;

/** Places a collapsed caret at (node, offset). */
function setCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Selects the range (node, start) → (node, end). */
function selectRange(node: Node, start: number, end: number): void {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Minimal refs object matching color-persistence's expectations. */
function makeRefs() {
  return {
    contentRef: { current: contentEl },
    activeColorSpanRef: { current: null as HTMLSpanElement | null },
    selectedTextColorRef: { current: null as string | null },
  };
}

/** Simulates the input event React would dispatch after typing. */
function fireInput(): void {
  handleEditorInput(
    { target: contentEl } as unknown as React.FormEvent<HTMLDivElement>,
    makeRefs(),
    () => {},
  );
}

beforeEach(() => {
  contentEl = document.createElement('div');
  contentEl.contentEditable = 'true';
  document.body.appendChild(contentEl);
});

afterEach(() => {
  contentEl.remove();
  window.getSelection()?.removeAllRanges();
});

describe('applyFont', () => {
  it('inserts a zero-width anchor span at a collapsed caret and places the caret inside it', () => {
    contentEl.textContent = 'hello';
    setCaret(contentEl.firstChild!, 5);

    expect(applyFont(contentEl, 'Georgia, serif')).toBe(true);

    const span = contentEl.querySelector('span')!;
    expect(span.style.fontFamily).toContain('Georgia');
    expect(span.textContent).toBe(ZWSP);

    const range = window.getSelection()!.getRangeAt(0);
    expect(span.contains(range.startContainer)).toBe(true);
  });

  it('keeps the chosen font when typing starts after picking it (reported bug)', () => {
    contentEl.textContent = 'hello';
    setCaret(contentEl.firstChild!, 5);
    applyFont(contentEl, 'Georgia, serif');

    // Simulate typing a character at the caret inside the anchor span.
    const span = contentEl.querySelector('span')!;
    const anchorText = span.firstChild as Text;
    anchorText.insertData(1, 'あ');
    setCaret(anchorText, 2);
    fireInput();

    // ZWSP is stripped, the typed character stays inside the font span,
    // and the caret remains inside so further typing keeps the font.
    expect(span.textContent).toBe('あ');
    expect(span.style.fontFamily).toContain('Georgia');
    const range = window.getSelection()!.getRangeAt(0);
    expect(span.contains(range.startContainer)).toBe(true);
  });

  it('applies and restores the caret when focus is on a toolbar button', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    contentEl.textContent = 'hello';
    // NOTE: Order emulates Chrome, which keeps the editor selection while a
    // toolbar button holds focus (jsdom resets the selection on focus()).
    button.focus();
    setCaret(contentEl.firstChild!, 3);

    expect(applyFont(contentEl, "'Noto Sans JP', sans-serif")).toBe(true);

    const span = contentEl.querySelector('span')!;
    expect(span.style.fontFamily).toContain('Noto Sans JP');
    // focusEditorPreservingRange must leave the caret inside the anchor span
    // even though focus() side effects may reset the selection.
    const range = window.getSelection()!.getRangeAt(0);
    expect(span.contains(range.startContainer)).toBe(true);
    button.remove();
  });

  it('wraps a non-collapsed selection in a font span', () => {
    contentEl.textContent = 'hello';
    selectRange(contentEl.firstChild!, 1, 4);

    expect(applyFont(contentEl, 'Georgia, serif')).toBe(true);

    const span = contentEl.querySelector('span')!;
    expect(span.textContent).toBe('ell');
    expect(span.style.fontFamily).toContain('Georgia');
    expect(contentEl.textContent).toBe('hello');
  });

  it('returns false when the selection is outside the editor', () => {
    const outside = document.createElement('div');
    outside.textContent = 'elsewhere';
    document.body.appendChild(outside);
    setCaret(outside.firstChild!, 0);

    expect(applyFont(contentEl, 'Georgia, serif')).toBe(false);
    expect(contentEl.querySelector('span')).toBeNull();
    outside.remove();
  });
});

describe('applyFontSize', () => {
  it('inserts a zero-width anchor span carrying the size at a collapsed caret', () => {
    contentEl.textContent = 'abc';
    setCaret(contentEl.firstChild!, 3);

    expect(applyFontSize(contentEl, '24px')).toBe(true);

    const span = contentEl.querySelector('span')!;
    expect(span.style.fontSize).toBe('24px');
    expect(span.textContent).toBe(ZWSP);
  });
});

describe('detectCurrentFormat', () => {
  it('reports the font of the span containing the caret', () => {
    contentEl.innerHTML = '<span style="font-family: Georgia, serif">styled</span>';
    const textNode = contentEl.querySelector('span')!.firstChild!;
    setCaret(textNode, 3);

    const format = detectCurrentFormat(contentEl);
    expect(format?.fontFamily).toBe('Georgia, serif');
  });

  it('reports "inherit" for unstyled text instead of the body Arial fallback', () => {
    contentEl.textContent = 'plain';
    setCaret(contentEl.firstChild!, 2);

    const format = detectCurrentFormat(contentEl);
    expect(format?.fontFamily).toBe('inherit');
  });

  it('converts rgba() colors without leaking alpha digits into the hex value', () => {
    contentEl.innerHTML = '<span style="color: rgba(220, 38, 38, 0.5)">red</span>';
    const textNode = contentEl.querySelector('span')!.firstChild!;
    setCaret(textNode, 1);

    const format = detectCurrentFormat(contentEl);
    expect(format?.textColor).toBe('#DC2626');
  });
});

describe('save/load round-trip', () => {
  it('preserves font-family spans through save cleanup and DOMPurify sanitization', () => {
    contentEl.innerHTML = '<span style="font-family: Georgia, serif">kept</span>';

    const saved = getContentWithoutDiagramSvg(contentEl);
    const reloaded = document.createElement('div');
    reloaded.innerHTML = DOMPurify.sanitize(saved);

    const span = reloaded.querySelector('span')!;
    expect(span.textContent).toBe('kept');
    expect(span.style.fontFamily).toContain('Georgia');
  });

  it('strips zero-width anchor spans from saved content but keeps real content', () => {
    contentEl.innerHTML =
      `<span style="font-family: Georgia, serif">real</span>` +
      `<span style="font-family: Georgia, serif">${ZWSP}</span>` +
      `<span style="font-size: 24px"></span>`;

    const saved = getContentWithoutDiagramSvg(contentEl);
    const reloaded = document.createElement('div');
    reloaded.innerHTML = saved;

    const spans = reloaded.querySelectorAll('span');
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe('real');
  });
});
