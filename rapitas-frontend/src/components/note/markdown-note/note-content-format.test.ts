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

  it('reads a single line with __strong__, *emphasis* or ~~strikethrough~~ as Markdown', () => {
    expect(isMarkdownNoteContent('__bold__')).toBe(true);
    expect(isMarkdownNoteContent('*important*')).toBe(true);
    expect(isMarkdownNoteContent('~~obsolete~~')).toBe(true);
    expect(isMarkdownNoteContent('これは *大事* なメモ')).toBe(true);
  });

  it('does not read a lone asterisk or unpaired marks on one line as Markdown', () => {
    expect(isMarkdownNoteContent('3 * 5')).toBe(false);
    expect(isMarkdownNoteContent('3 * 5 * 7')).toBe(false);
    expect(isMarkdownNoteContent('* 印だけ*')).toBe(true); // a list item, as before
    expect(isMarkdownNoteContent('a ~ b ~~ c')).toBe(false);
    expect(isMarkdownNoteContent('Just a plain one-line sentence.')).toBe(false);
  });

  it('does not read __ inside a word as strong emphasis (CommonMark)', () => {
    expect(isMarkdownNoteContent('foo__bar__baz')).toBe(false);
    expect(isMarkdownNoteContent('__init__method')).toBe(false);
    expect(isMarkdownNoteContent('call __init__ now')).toBe(true);
    expect(isMarkdownNoteContent('これは __大事__ なメモ')).toBe(true);
  });

  it('does not read a backslash-escaped delimiter as a mark', () => {
    expect(isMarkdownNoteContent('\\__bold__')).toBe(false);
    expect(isMarkdownNoteContent('\\~~obsolete~~')).toBe(false);
    expect(isMarkdownNoteContent('*important\\*')).toBe(false);
    expect(isMarkdownNoteContent('~~obsolete\\~~')).toBe(false);
    expect(isMarkdownNoteContent('__bold\\__')).toBe(false);
    expect(isMarkdownNoteContent('**bold\\**')).toBe(false);
    expect(isMarkdownNoteContent('\\*\\*bold\\*\\*')).toBe(false);
  });

  it('still reads a mark after an escaped backslash as Markdown', () => {
    expect(isMarkdownNoteContent('\\\\__bold__')).toBe(true);
    expect(isMarkdownNoteContent('\\\\*important*')).toBe(true);
    expect(isMarkdownNoteContent('\\\\**bold**')).toBe(true);
  });

  it('lets Markdown marks win over an HTML entity reference', () => {
    expect(isMarkdownNoteContent('## Plan\n\nAT&amp;T')).toBe(true);
    expect(isMarkdownNoteContent('- a &lt; b\n- c &gt; d')).toBe(true);
    expect(isMarkdownNoteContent('**AT&amp;T** の件')).toBe(true);
    expect(isMarkdownNoteContent('# Q&amp;A &quot;x&quot; &#39;y&#39; a&nbsp;b')).toBe(true);
  });

  it('still reads rich editor HTML as not Markdown, with or without entities', () => {
    expect(isMarkdownNoteContent('<p>hello</p>')).toBe(false);
    expect(isMarkdownNoteContent('<p>__bold__</p>')).toBe(false);
    expect(isMarkdownNoteContent('<p>AT&amp;T</p><div>a&nbsp;b</div>')).toBe(false);
    expect(isMarkdownNoteContent('## 見出し<br>AT&amp;T')).toBe(false);
    expect(isMarkdownNoteContent('AT&amp;T')).toBe(false);
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

  it('drops the allowed inline HTML tags from a Markdown preview, keeping the text', () => {
    expect(noteContentToPlainText('# 色\n\n<span style="color:#E53935">赤字</span>です')).toBe(
      '色 赤字です',
    );
    expect(
      noteContentToPlainText(
        '- <mark style="background-color:#FFF59D">重要</mark> と <u>下線</u> と <span style="font-size:24px">大</span>',
      ),
    ).toBe('重要 と 下線 と 大');
    expect(noteContentToPlainText('<span style="color:#E53935">赤字</span>です')).toBe('赤字です');
  });
});
