/**
 * editor-keydown-enter.test
 *
 * Tests for Enter-key span handling: font/size spans continue onto the new
 * line (regression for the font reverting to Arial after Enter), text-color
 * spans keep their persistence tracking, and highlight spans are escaped.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type React from 'react';
import { handleEnter } from './editor-keydown-enter';
import type { EditorRefs } from './editor-keydown.types';

const ZWSP = '​';

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

/** Builds a minimal Enter keydown event; only preventDefault is consumed. */
function makeEnterEvent() {
  return {
    key: 'Enter',
    shiftKey: false,
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
  };
});

afterEach(() => {
  contentEl.remove();
  window.getSelection()?.removeAllRanges();
});

describe('handleEnter — font span continuation', () => {
  it('continues the font onto the new line when Enter is pressed mid-span', () => {
    contentEl.innerHTML = '<span style="font-family: Georgia, serif">abcdef</span>';
    const textNode = contentEl.querySelector('span')!.firstChild!;
    setCaret(textNode, 3);

    const e = makeEnterEvent();
    handleEnter(e, refs, () => {});

    expect(e.preventDefault).toHaveBeenCalled();
    const spans = contentEl.querySelectorAll('span');
    // Original (leading), continuation anchor, trailing content.
    expect(spans).toHaveLength(3);
    expect(spans[0].textContent).toBe('abc');
    expect(spans[1].textContent).toBe(ZWSP);
    expect(spans[1].style.fontFamily).toContain('Georgia');
    expect(spans[2].textContent).toBe('def');
    expect(spans[2].style.fontFamily).toContain('Georgia');
    expect(contentEl.querySelector('br')).not.toBeNull();

    // Caret sits inside the continuation anchor so typing keeps the font.
    const range = window.getSelection()!.getRangeAt(0);
    expect(spans[1].contains(range.startContainer)).toBe(true);
  });

  it('continues the font when Enter is pressed at the end of the span', () => {
    contentEl.innerHTML = '<span style="font-family: Georgia, serif">abc</span>';
    const textNode = contentEl.querySelector('span')!.firstChild!;
    setCaret(textNode, 3);

    const e = makeEnterEvent();
    handleEnter(e, refs, () => {});

    expect(e.preventDefault).toHaveBeenCalled();
    const spans = contentEl.querySelectorAll('span');
    expect(spans).toHaveLength(2);
    expect(spans[1].textContent).toBe(ZWSP);
    expect(spans[1].style.fontFamily).toContain('Georgia');
  });

  it('continues font-size spans as well', () => {
    contentEl.innerHTML = '<span style="font-size: 24px">abc</span>';
    const textNode = contentEl.querySelector('span')!.firstChild!;
    setCaret(textNode, 3);

    handleEnter(makeEnterEvent(), refs, () => {});

    const spans = contentEl.querySelectorAll('span');
    expect(spans[1].style.fontSize).toBe('24px');
    expect(spans[1].textContent).toBe(ZWSP);
  });

  it('does NOT register pure font spans in the color-persistence tracking', () => {
    contentEl.innerHTML = '<span style="font-family: Georgia, serif">abc</span>';
    setCaret(contentEl.querySelector('span')!.firstChild!, 3);

    handleEnter(makeEnterEvent(), refs, () => {});

    expect(refs.activeColorSpanRef.current).toBeNull();
  });
});

describe('handleEnter — existing span behaviours are preserved', () => {
  it('continues text-color spans and registers the anchor for persistence', () => {
    contentEl.innerHTML = '<span style="color: rgb(220, 38, 38)">abc</span>';
    setCaret(contentEl.querySelector('span')!.firstChild!, 3);

    const e = makeEnterEvent();
    handleEnter(e, refs, () => {});

    expect(e.preventDefault).toHaveBeenCalled();
    const spans = contentEl.querySelectorAll('span');
    expect(spans).toHaveLength(2);
    expect(spans[1].style.color).toBe('rgb(220, 38, 38)');
    expect(refs.activeColorSpanRef.current).toBe(spans[1]);
  });

  it('escapes highlight spans — the new line starts unstyled', () => {
    contentEl.innerHTML = '<span style="background-color: yellow">abc</span>';
    setCaret(contentEl.querySelector('span')!.firstChild!, 3);

    const e = makeEnterEvent();
    handleEnter(e, refs, () => {});

    expect(e.preventDefault).toHaveBeenCalled();
    // No continuation anchor is created for highlights.
    expect(contentEl.querySelectorAll('span')).toHaveLength(1);
    const range = window.getSelection()!.getRangeAt(0);
    expect(contentEl.querySelector('span')!.contains(range.startContainer)).toBe(false);
  });

  it('does nothing special outside any styled span', () => {
    contentEl.textContent = 'plain';
    setCaret(contentEl.firstChild!, 3);

    const e = makeEnterEvent();
    handleEnter(e, refs, () => {});

    // Falls through to browser default — no preventDefault, no DOM changes.
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(contentEl.innerHTML).toBe('plain');
  });
});
