/**
 * markdown-density.test
 *
 * `MarkdownView` keeps the document rhythm by default (the workflow file
 * viewer and other existing callers must not change) and only tightens for
 * a chat bubble when asked.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownView } from './MarkdownView';
import { densityClass } from './markdown-density';

const wrapper = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe('MarkdownView density', () => {
  it('is the document rhythm when no density is given', () => {
    const { container } = render(<MarkdownView content={'# 見出し\n\n本文'} />);
    expect(wrapper(container).dataset.density).toBe('document');
    expect(wrapper(container).className).not.toContain('[&_h1]:');
    expect(densityClass('document')).toBe('');
  });

  it('tightens headings and margins for a chat bubble', () => {
    const { container } = render(<MarkdownView content={'# 見出し\n\n本文'} density="chat" />);
    const cls = wrapper(container).className;
    expect(wrapper(container).dataset.density).toBe('chat');
    expect(cls).toContain('[&_h1]:!text-[15px]');
    expect(cls).toContain('[&_h2]:!mt-3');
    expect(cls).toContain('[&_p]:!my-1.5');
  });

  it('keeps a caller className alongside the density', () => {
    const { container } = render(<MarkdownView content="本文" density="chat" className="extra" />);
    expect(wrapper(container).className).toContain('extra');
  });
});

// The note density mirrors the phone's NoteContentMarkdown (flutter_markdown_plus
// with the task-description style sheet), so one note reads the same on both.
describe('MarkdownView note density', () => {
  it('sets the phone note rhythm: plain bold headings, underlined links, bordered cells', () => {
    const { container } = render(<MarkdownView content={'## 見出し\n\n本文'} density="note" />);
    const cls = wrapper(container).className;
    expect(wrapper(container).dataset.density).toBe('note');
    expect(cls).toContain('[&_h2]:!border-b-0');
    expect(cls).toContain('[&_h2]:before:!hidden');
    expect(cls).toContain('[&_a]:!underline');
    expect(cls).toContain('[&_td]:!border');
    // Typography wraps quotes in “ ” marks; the phone shows the text alone.
    expect(cls).toContain('[&_blockquote_p]:before:!content-none');
  });

  it('keeps a single newline as a line break, as the phone does (softLineBreak)', () => {
    const { container } = render(<MarkdownView content={'1行目\n2行目'} density="note" />);
    expect(container.querySelector('p br')).not.toBeNull();
  });

  it('does not change how the other densities treat a single newline', () => {
    const { container } = render(<MarkdownView content={'1行目\n2行目'} />);
    expect(container.querySelector('p br')).toBeNull();
    const chat = render(<MarkdownView content={'1行目\n2行目'} density="chat" />);
    expect(chat.container.querySelector('p br')).toBeNull();
  });

  it('renders headings, lists, tables, code and links in a note', () => {
    const md = [
      '## 見出し',
      '',
      '### 小見出し',
      '',
      '- 箇条書き',
      '',
      '1. 番号',
      '',
      '| 列A | 列B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '[リンク](https://example.com)',
    ].join('\n');
    const { container } = render(<MarkdownView content={md} density="note" />);
    expect(container.querySelector('h2')?.textContent).toBe('見出し');
    expect(container.querySelector('h3')?.textContent).toBe('小見出し');
    expect(container.querySelector('ul li')?.textContent).toBe('箇条書き');
    expect(container.querySelector('ol li')?.textContent).toBe('番号');
    expect(container.querySelectorAll('table td')).toHaveLength(2);
    expect(container.querySelector('pre code')?.textContent).toContain('const a = 1;');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });
});
