/**
 * block-format.test
 *
 * Tests for JIRA-style block conversion: p↔heading conversion, BR-delimited
 * line wrapping, multi-block selections, inline-span survival, current-block
 * detection, heading Enter behaviour, and the sanitize round-trip.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type React from 'react';
import DOMPurify from 'dompurify';
import { applyBlockFormat, detectCurrentBlockType, handleHeadingEnter } from './block-format';
import { getContentWithoutDiagramSvg } from './diagram-block';

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

/** Selects from (startNode, startOffset) to (endNode, endOffset). */
function selectAcross(
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
): void {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
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

const contentRef = { current: null as HTMLDivElement | null };

beforeEach(() => {
  contentEl = document.createElement('div');
  contentEl.contentEditable = 'true';
  document.body.appendChild(contentEl);
  contentRef.current = contentEl;
});

afterEach(() => {
  contentEl.remove();
  window.getSelection()?.removeAllRanges();
});

describe('applyBlockFormat — element blocks', () => {
  it('converts a paragraph-like div to h2', () => {
    contentEl.innerHTML = '<div>hello</div>';
    setCaret(contentEl.querySelector('div')!.firstChild!, 2);

    expect(applyBlockFormat(contentEl, 'h2')).toBe(true);
    expect(contentEl.innerHTML).toBe('<h2>hello</h2>');
  });

  it('converts a heading back to a paragraph', () => {
    contentEl.innerHTML = '<h2>title</h2>';
    setCaret(contentEl.querySelector('h2')!.firstChild!, 3);

    expect(applyBlockFormat(contentEl, 'p')).toBe(true);
    expect(contentEl.innerHTML).toBe('<p>title</p>');
  });

  it('converts every block intersecting a multi-block selection', () => {
    contentEl.innerHTML = '<div>first</div><div>second</div>';
    const [a, b] = Array.from(contentEl.querySelectorAll('div'));
    selectAcross(a.firstChild!, 1, b.firstChild!, 3);

    expect(applyBlockFormat(contentEl, 'h3')).toBe(true);
    expect(contentEl.innerHTML).toBe('<h3>first</h3><h3>second</h3>');
  });

  it('keeps inline font/color spans intact through conversion', () => {
    contentEl.innerHTML = '<div>a <span style="font-family: Georgia, serif">styled</span> b</div>';
    setCaret(contentEl.querySelector('span')!.firstChild!, 2);

    expect(applyBlockFormat(contentEl, 'h1')).toBe(true);
    const h1 = contentEl.querySelector('h1')!;
    expect(h1.textContent).toBe('a styled b');
    expect(h1.querySelector('span')!.style.fontFamily).toContain('Georgia');
  });

  it('restores the caret inside the converted block', () => {
    contentEl.innerHTML = '<div>hello</div>';
    const textNode = contentEl.querySelector('div')!.firstChild!;
    setCaret(textNode, 2);

    applyBlockFormat(contentEl, 'h2');

    const range = window.getSelection()!.getRangeAt(0);
    expect(contentEl.querySelector('h2')!.contains(range.startContainer)).toBe(true);
    expect(range.startOffset).toBe(2);
  });

  it('never converts protected diagram blocks', () => {
    contentEl.innerHTML =
      '<div class="diagram-block"><pre class="diagram-source">graph TD</pre></div>';
    setCaret(contentEl.querySelector('.diagram-source')!.firstChild!, 0);

    expect(applyBlockFormat(contentEl, 'h2')).toBe(false);
    expect(contentEl.querySelector('.diagram-block')).not.toBeNull();
    expect(contentEl.querySelector('h2')).toBeNull();
  });
});

describe('applyBlockFormat — BR-delimited inline lines', () => {
  it('wraps only the caret line and consumes its terminating BR', () => {
    contentEl.innerHTML = 'hello<br>world';
    setCaret(contentEl.firstChild!, 2);

    expect(applyBlockFormat(contentEl, 'h2')).toBe(true);
    expect(contentEl.innerHTML).toBe('<h2>hello</h2>world');
  });

  it('wraps a second line without touching the first', () => {
    contentEl.innerHTML = 'hello<br>world';
    setCaret(contentEl.lastChild!, 3);

    expect(applyBlockFormat(contentEl, 'h3')).toBe(true);
    expect(contentEl.innerHTML).toBe('hello<br><h3>world</h3>');
  });

  it('seeds a styled block in an empty editor', () => {
    setCaret(contentEl, 0);

    expect(applyBlockFormat(contentEl, 'h1')).toBe(true);
    expect(contentEl.innerHTML).toBe('<h1><br></h1>');
  });
});

describe('detectCurrentBlockType', () => {
  it('reports the heading containing the caret', () => {
    contentEl.innerHTML = '<h2>title</h2>';
    setCaret(contentEl.querySelector('h2')!.firstChild!, 1);
    expect(detectCurrentBlockType(contentEl)).toBe('h2');
  });

  it('reports p for divs and bare text', () => {
    contentEl.innerHTML = '<div>block</div>plain';
    setCaret(contentEl.querySelector('div')!.firstChild!, 1);
    expect(detectCurrentBlockType(contentEl)).toBe('p');
    setCaret(contentEl.lastChild!, 2);
    expect(detectCurrentBlockType(contentEl)).toBe('p');
  });

  it('reports headings through inline span wrappers', () => {
    contentEl.innerHTML = '<h3><span style="color: rgb(255, 0, 0)">x</span></h3>';
    setCaret(contentEl.querySelector('span')!.firstChild!, 1);
    expect(detectCurrentBlockType(contentEl)).toBe('h3');
  });
});

describe('handleHeadingEnter', () => {
  it('starts a normal paragraph when Enter is pressed at the end of a heading', () => {
    contentEl.innerHTML = '<h2>title</h2>';
    const textNode = contentEl.querySelector('h2')!.firstChild!;
    setCaret(textNode, 5);

    const e = makeEnterEvent();
    expect(handleHeadingEnter(e, contentRef, () => {})).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();

    const p = contentEl.querySelector('h2 + p')!;
    expect(p).not.toBeNull();
    expect(p.querySelector('br')).not.toBeNull();
    const range = window.getSelection()!.getRangeAt(0);
    expect(p.contains(range.startContainer) || range.startContainer === p).toBe(true);
  });

  it('does not intercept Enter mid-heading (browser splits normally)', () => {
    contentEl.innerHTML = '<h2>title</h2>';
    setCaret(contentEl.querySelector('h2')!.firstChild!, 2);

    const e = makeEnterEvent();
    expect(handleHeadingEnter(e, contentRef, () => {})).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('does not intercept Enter outside a heading', () => {
    contentEl.innerHTML = '<div>plain</div>';
    setCaret(contentEl.querySelector('div')!.firstChild!, 5);

    expect(handleHeadingEnter(makeEnterEvent(), contentRef, () => {})).toBe(false);
  });
});

describe('sanitize round-trip', () => {
  it('keeps h1-h3 through save cleanup and DOMPurify sanitization', () => {
    contentEl.innerHTML = '<h1>one</h1><h2>two</h2><h3>three</h3><p>body</p>';

    const saved = getContentWithoutDiagramSvg(contentEl);
    const reloaded = document.createElement('div');
    reloaded.innerHTML = DOMPurify.sanitize(saved);

    expect(reloaded.querySelector('h1')?.textContent).toBe('one');
    expect(reloaded.querySelector('h2')?.textContent).toBe('two');
    expect(reloaded.querySelector('h3')?.textContent).toBe('three');
    expect(reloaded.querySelector('p')?.textContent).toBe('body');
  });
});
