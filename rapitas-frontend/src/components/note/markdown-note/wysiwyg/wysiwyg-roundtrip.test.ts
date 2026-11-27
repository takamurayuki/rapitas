/**
 * wysiwyg-roundtrip.test
 *
 * Markdown opened in the visual editor and written back without an edit is
 * the same Markdown, for every construct the editor offers, so opening a
 * note never rewrites it.
 */
import { describe, it, expect } from 'vitest';
import { domToMarkdown } from '../html-to-markdown';
import { markdownToEditableHtml, roundTripChanges } from './markdown-to-editable-html';

function roundTrip(markdown: string): string {
  const root = document.createElement('div');
  root.innerHTML = markdownToEditableHtml(markdown);
  return domToMarkdown(root);
}

const CASES: Array<[string, string]> = [
  ['headings', '# 見出し1\n\n## 見出し2\n\n### 見出し3'],
  ['a paragraph with a line break', '一行目\n二行目'],
  ['bullets and numbers', '- 一\n- 二\n\n1. いち\n2. に'],
  ['a nested list', '- 親\n  - 子'],
  ['a checklist', '- [ ] 未完\n- [x] 完了'],
  ['a quote', '> 引用'],
  ['code with a language', '```ts\nconst a = 1;\n```'],
  ['a mermaid diagram', '```mermaid\ngraph TD\n  A-->B\n```'],
  ['a table', '| 列1 | 列2 |\n| --- | --- |\n| a | b |'],
  ['a link', '[参考](https://example.com)'],
  ['bold, italic and strike', '**太** *斜* ~~消~~'],
  ['text colour', '<span style="color:#E53935">赤字</span>'],
  ['highlight', '<mark style="background-color:#FFF59D">重要</mark>'],
  ['font size', '<span style="font-size:24px">大</span>'],
  ['underline', '<u>下線</u>'],
  ['bold inside a colour', '前<span style="color:#E53935">**太**</span>後'],
  [
    'nested allowed forms',
    '<span style="font-size:24px"><span style="color:#E53935">大赤</span></span>',
  ],
];

describe('the visual editor round trip', () => {
  for (const [name, markdown] of CASES) {
    it(`keeps ${name} unchanged`, () => {
      expect(roundTrip(markdown)).toBe(markdown);
      expect(roundTripChanges(markdown, markdownToEditableHtml(markdown))).toBe(false);
    });
  }

  it('gives the checklist boxes back to the user (not disabled)', () => {
    const html = markdownToEditableHtml('- [ ] 未完');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('disabled');
  });

  it('keeps disallowed HTML as text, never as an element', () => {
    const html = markdownToEditableHtml('前<script>alert(1)</script><span onclick="x">a</span>');
    const scratch = document.createElement('div');
    scratch.innerHTML = html;
    expect(scratch.querySelector('script')).toBeNull();
    expect(scratch.querySelector('[onclick]')).toBeNull();
    expect(html).not.toContain('<script');
  });

  it('reports a body the editor would write differently', () => {
    const markdown = '* 星の箇条書き';
    expect(roundTripChanges(markdown, markdownToEditableHtml(markdown))).toBe(true);
  });

  it('opens an empty body as an empty surface', () => {
    expect(markdownToEditableHtml('')).toBe('');
  });
});
