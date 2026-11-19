/**
 * html-to-markdown.test
 *
 * What the old rich editor wrote comes out as Markdown a person can check
 * before saving: structure is kept, styling Markdown cannot hold is dropped,
 * and a Mermaid diagram block becomes a mermaid fence.
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

  it('drops colour and font styling but keeps the text, and the result is no longer HTML', () => {
    const md = htmlToMarkdown(
      '<p><span style="color:red">赤</span><font size="5">大</font><u>下線</u><mark>強調</mark></p>',
    );
    expect(md).toBe('赤大下線強調');
    expect(isLegacyEditorHtml(md)).toBe(false);
  });

  it('removes script and event handlers', () => {
    expect(htmlToMarkdown('<p onclick="x()">安全</p><script>alert(1)</script>')).toBe('安全');
  });
});
