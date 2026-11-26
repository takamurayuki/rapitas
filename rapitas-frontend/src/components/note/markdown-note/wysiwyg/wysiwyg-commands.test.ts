/**
 * wysiwyg-commands.test
 *
 * The table of operations the task names: doing each one on the WYSIWYG
 * surface and writing the surface out gives exactly this Markdown.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { domToMarkdown } from '../html-to-markdown';
import {
  applyFontSize,
  applyHighlight,
  applyInlineMark,
  applyTextColor,
  insertTable,
  isNoteHexColour,
  toggleChecklist,
} from './wysiwyg-commands';
import { NOTE_HIGHLIGHT_COLORS } from './wysiwyg-palette';

function surface(html: string): HTMLDivElement {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

/** Select the whole text of the first text node under `el`. */
function selectText(el: Element) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode() as Text;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, text.length);
  const sel = window.getSelection() as Selection;
  sel.removeAllRanges();
  sel.addRange(range);
}

function caretIn(el: Element) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  const sel = window.getSelection() as Selection;
  sel.removeAllRanges();
  sel.addRange(range);
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the operation table', () => {
  it('text colour #E53935 on 「赤字」', () => {
    const root = surface('<p>赤字</p>');
    selectText(root);
    expect(applyTextColor(root, '#E53935')).toBe(true);
    expect(domToMarkdown(root)).toBe('<span style="color:#E53935">赤字</span>');
  });

  it('yellow highlight on 「重要」', () => {
    const root = surface('<p>重要</p>');
    selectText(root);
    const yellow = NOTE_HIGHLIGHT_COLORS.find((c) => c.key === 'yellow')?.value as string;
    expect(applyHighlight(root, yellow)).toBe(true);
    expect(domToMarkdown(root)).toBe('<mark style="background-color:#FFF59D">重要</mark>');
  });

  it('font size 24 on 「大」', () => {
    const root = surface('<p>大</p>');
    selectText(root);
    expect(applyFontSize(root, 24)).toBe(true);
    expect(domToMarkdown(root)).toBe('<span style="font-size:24px">大</span>');
  });

  it('bold on 「太字」', () => {
    const root = surface('<p>太字</p>');
    selectText(root);
    // jsdom has no execCommand; the stub does what a browser's bold does.
    const exec = vi.fn((command: string) => {
      if (command !== 'bold') return false;
      const range = (window.getSelection() as Selection).getRangeAt(0);
      const b = document.createElement('b');
      range.surroundContents(b);
      return true;
    });
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    expect(applyInlineMark(root, 'bold')).toBe(true);
    expect(exec).toHaveBeenCalledWith('bold', false);
    expect(domToMarkdown(root)).toBe('**太字**');
  });

  it('a 2×2 table is a GFM table with a header row and a delimiter row', () => {
    const root = surface('<p>前</p>');
    caretIn(root.querySelector('p') as Element);
    expect(insertTable(root, { rows: 2, columns: 2 }, (n) => `列${n}`)).toBe(true);
    expect(domToMarkdown(root)).toBe(
      ['前', '', '| 列1 | 列2 |', '| --- | --- |', '|  |  |', '|  |  |'].join('\n'),
    );
  });

  it('a checklist from the paragraph 「項目」', () => {
    const root = surface('<p>項目</p>');
    caretIn(root.querySelector('p') as Element);
    expect(toggleChecklist(root)).toBe(true);
    expect(domToMarkdown(root)).toBe('- [ ] 項目');
  });
});

describe('guards', () => {
  it('does nothing when the selection is outside the surface', () => {
    const root = surface('<p>中</p>');
    const outside = document.createElement('p');
    outside.textContent = '外';
    document.body.appendChild(outside);
    selectText(outside);
    expect(applyTextColor(root, '#E53935')).toBe(false);
    expect(root.innerHTML).toBe('<p>中</p>');
  });

  it('does nothing with a collapsed selection', () => {
    const root = surface('<p>中</p>');
    caretIn(root.querySelector('p') as Element);
    expect(applyFontSize(root, 24)).toBe(false);
  });

  it('refuses a colour that is not #RRGGBB and a size out of range', () => {
    const root = surface('<p>中</p>');
    selectText(root);
    expect(applyTextColor(root, 'red')).toBe(false);
    expect(applyTextColor(root, 'url(http://x)')).toBe(false);
    expect(applyFontSize(root, 73)).toBe(false);
    expect(applyFontSize(root, 7)).toBe(false);
    expect(root.innerHTML).toBe('<p>中</p>');
  });

  it('accepts only six-digit hex colours', () => {
    expect(isNoteHexColour('#e53935')).toBe(true);
    expect(isNoteHexColour('#fff')).toBe(false);
    expect(isNoteHexColour('rgb(1,2,3)')).toBe(false);
  });

  it('wraps a selection that crosses element boundaries', () => {
    const root = surface('<p>あ<b>い</b>う</p>');
    const p = root.querySelector('p') as Element;
    const range = document.createRange();
    range.setStart(p.firstChild as Text, 0);
    range.setEnd(p.lastChild as Text, 1);
    const sel = window.getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(applyTextColor(root, '#E53935')).toBe(true);
    expect(domToMarkdown(root)).toBe('<span style="color:#E53935">あ**い**う</span>');
  });

  it('makes a checklist from a line typed straight into an empty surface (no paragraph)', () => {
    const root = surface('');
    root.appendChild(document.createTextNode('項目'));
    caretIn(root.firstChild as Node as Element);
    expect(toggleChecklist(root)).toBe(true);
    expect(domToMarkdown(root)).toBe('- [ ] 項目');
  });

  it('inserts a table after a line typed straight into the surface', () => {
    const root = surface('');
    root.appendChild(document.createTextNode('前'));
    caretIn(root.firstChild as Node as Element);
    expect(insertTable(root, { rows: 1, columns: 1 }, (n) => `列${n}`)).toBe(true);
    expect(domToMarkdown(root)).toBe(['前', '', '| 列1 |', '| --- |', '|  |'].join('\n'));
  });

  it('turns a checklist item back into a paragraph', () => {
    const root = surface('<ul><li><input type="checkbox">項目</li></ul>');
    caretIn(root.querySelector('li') as Element);
    expect(toggleChecklist(root)).toBe(true);
    expect(domToMarkdown(root)).toBe('項目');
  });
});
