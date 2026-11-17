/**
 * note-content-format.test
 *
 * A note body is either the desktop rich editor's HTML or Markdown (what ラピ,
 * the phone and the roadmap write). The two must not be confused: Markdown
 * dropped into the rich editor loses its line breaks and shows its marks, and
 * editor HTML rendered as Markdown shows its tags.
 */
import { describe, it, expect } from 'vitest';
import { isMarkdownNoteContent, noteContentToPlainText } from './note-content-format';

describe('isMarkdownNoteContent', () => {
  it('reads a copilot note (headings and a list) as Markdown', () => {
    expect(isMarkdownNoteContent('## 質問\n\n何?\n\n## ラピの回答\n\n- a\n- b\n')).toBe(true);
  });

  it('reads Markdown with a code fence or inline code mentioning a tag as Markdown', () => {
    expect(isMarkdownNoteContent('## 例\n\n```html\n<div>x</div>\n```\n')).toBe(true);
    expect(isMarkdownNoteContent('`<br>` を使わない\nもう1行')).toBe(true);
  });

  it('reads plain multi-line text as Markdown (the rich editor never saves a bare newline)', () => {
    expect(isMarkdownNoteContent('1行目\n2行目')).toBe(true);
  });

  it('reads the rich editor output as not Markdown', () => {
    expect(isMarkdownNoteContent('<h2>見出し</h2><p>本文</p>')).toBe(false);
    expect(isMarkdownNoteContent('一行目<div>二行目</div>')).toBe(false);
    expect(isMarkdownNoteContent('a&nbsp;b')).toBe(false);
  });

  it('leaves empty and single plain lines to the rich editor, as before', () => {
    expect(isMarkdownNoteContent('')).toBe(false);
    expect(isMarkdownNoteContent('   ')).toBe(false);
    expect(isMarkdownNoteContent('ただのメモ')).toBe(false);
  });

  it('reads a single line with a Markdown mark as Markdown', () => {
    expect(isMarkdownNoteContent('# 転職する')).toBe(true);
    expect(isMarkdownNoteContent('- 項目')).toBe(true);
    expect(isMarkdownNoteContent('**太字**のメモ')).toBe(true);
    expect(isMarkdownNoteContent('[リンク](https://example.com)')).toBe(true);
  });
});

describe('noteContentToPlainText', () => {
  it('strips Markdown marks from a Markdown note', () => {
    const md =
      '## 質問\n\n**何**を `使う`?\n\n- [資料](https://x.test)\n\n| a | b |\n| --- | --- |';
    expect(noteContentToPlainText(md)).toBe('質問 何を 使う? 資料 a b');
  });

  it('drops a mermaid fence body from the preview', () => {
    expect(noteContentToPlainText('## 図\n\n```mermaid\nflowchart TD\n  A-->B\n```\n後')).toBe(
      '図 後',
    );
  });

  it('strips tags from rich editor HTML as the previews did before', () => {
    expect(noteContentToPlainText('<h2>見出し</h2><p>本文</p>')).toBe('見出し本文');
    expect(noteContentToPlainText('<p><b><i>x</i></b></p>')).toBe('x');
  });
});
