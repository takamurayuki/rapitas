/**
 * html-to-markdown.test
 *
 * What the old rich editor wrote comes out as Markdown a person can check
 * before saving: structure is kept, colour / highlight / font size / underline
 * stay as the allowed inline HTML, other styling is dropped, and a Mermaid
 * diagram block becomes a mermaid fence.
 */
import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from './html-to-markdown';
import { isLegacyEditorHtml } from './note-content-kind';

describe('htmlToMarkdown', () => {
  it('turns editor lines into paragraphs and keeps headings and marks', () => {
    expect(htmlToMarkdown('<div>一行目</div><div><br></div><div><b>二</b>行目</div>')).toBe(
      '一行目\n\n**二**行目',
    );
    expect(htmlToMarkdown('<h3>小見出し</h3><p><em>斜体</em> と <s>取消</s></p>')).toBe(
      '### 小見出し\n\n*斜体* と ~~取消~~',
    );
  });

  it('keeps nested lists, links, quotes and code', () => {
    const md = htmlToMarkdown(
      '<ol><li>一<ul><li>子</li></ul></li><li>二</li></ol>' +
        '<blockquote><p>引用</p></blockquote>' +
        '<p><a href="https://example.com">リンク</a> と <code>x</code></p>' +
        '<pre><code class="language-ts">const a = 1;\n</code></pre>',
    );
    expect(md).toBe(
      '1. 一\n  - 子\n2. 二\n\n> 引用\n\n[リンク](https://example.com) と `x`\n\n```ts\nconst a = 1;\n```',
    );
  });

  it('writes a table as a GFM table and a diagram block as a mermaid fence', () => {
    expect(
      htmlToMarkdown('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'),
    ).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(
      htmlToMarkdown(
        '<div class="diagram-block"><pre class="diagram-source">graph TD\n  A--&gt;B</pre><div class="diagram-render"><svg></svg></div></div>',
      ),
    ).toBe('```mermaid\ngraph TD\n  A-->B\n```');
  });

  it('keeps the allowed inline forms of colour, size, highlight and underline; the result is no longer HTML', () => {
    const md = htmlToMarkdown(
      '<p><span style="color:red">赤</span><font size="5">大</font><u>下線</u><mark>強調</mark></p>',
    );
    // A colour name and a style-less mark have no allowed form: their text stays.
    expect(md).toBe('赤大<u>下線</u>強調');
    expect(isLegacyEditorHtml(md)).toBe(false);
  });

  it('writes the editor colour (rgb or hex) as a text-colour span', () => {
    expect(htmlToMarkdown('<p><span style="color: rgb(229, 57, 53);">赤字</span></p>')).toBe(
      '<span style="color:#E53935">赤字</span>',
    );
    expect(htmlToMarkdown('<div><font color="#e53935">赤字</font></div>')).toBe(
      '<span style="color:#E53935">赤字</span>',
    );
    expect(htmlToMarkdown('<p><span style="color: rgba(0, 0, 0, 0)">透明</span></p>')).toBe('透明');
  });

  it('writes a highlight (solid or the old gradient) as a mark', () => {
    expect(
      htmlToMarkdown(
        '<p><span style="background-color: rgb(255, 245, 157); padding: 0 2px; border-radius: 2px;">重要</span></p>',
      ),
    ).toBe('<mark style="background-color:#FFF59D">重要</mark>');
    expect(
      htmlToMarkdown(
        '<p><span style="background: linear-gradient(transparent 60%, rgb(254, 240, 138) 60%); padding: 0 1px;">下線風</span></p>',
      ),
    ).toBe('<mark style="background-color:#FEF08A">下線風</mark>');
  });

  it('keeps a font size in 8..72px and drops others', () => {
    expect(htmlToMarkdown('<p><span style="font-size: 24px;">大</span></p>')).toBe(
      '<span style="font-size:24px">大</span>',
    );
    expect(htmlToMarkdown('<p><span style="font-size: 96px;">巨大</span></p>')).toBe('巨大');
    expect(htmlToMarkdown('<p><span style="font-size: 2em;">相対</span></p>')).toBe('相対');
  });

  it('nests several styles in the canonical order and drops fonts and borders', () => {
    expect(
      htmlToMarkdown(
        '<p><span style="color: rgb(229, 57, 53); font-size: 24px; font-family: serif; border-left: 3px solid red;">両方</span></p>',
      ),
    ).toBe('<span style="font-size:24px"><span style="color:#E53935">両方</span></span>');
    expect(
      htmlToMarkdown(
        '<p><span style="color: rgb(229, 57, 53);"><span style="font-size: 24px;">内外</span></span></p>',
      ),
    ).toBe('<span style="font-size:24px"><span style="color:#E53935">内外</span></span>');
  });

  it('puts the allowed form outside bold so the bold still reads in Markdown', () => {
    expect(
      htmlToMarkdown('<p>前<b><span style="color: rgb(229, 57, 53);">太</span></b>後</p>'),
    ).toBe('前<span style="color:#E53935">**太**</span>後');
  });

  it('writes a checklist item as a GFM task', () => {
    expect(
      htmlToMarkdown(
        '<ul><li><input type="checkbox"> 項目</li><li><input type="checkbox" checked> 済み</li></ul>',
      ),
    ).toBe('- [ ] 項目\n- [x] 済み');
  });

  it('removes script and event handlers', () => {
    expect(htmlToMarkdown('<p onclick="x()">安全</p><script>alert(1)</script>')).toBe('安全');
  });
});
