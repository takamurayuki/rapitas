/**
 * note-inline-html.test
 *
 * The save-time strip of inline HTML (allowed forms only). The input/output
 * table is shared with the frontend through note-inline-html.cases.json so
 * both sides strip a body the same way.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseInlineHtmlTag, prepareNewMarkdownContent, sanitizeNoteInlineHtml } from './index';
import { MAX_NOTE_CONTENT } from '../note-limits';

interface StripCase {
  name: string;
  input: string;
  output: string;
}

const table = JSON.parse(
  readFileSync(join(import.meta.dir, 'note-inline-html.cases.json'), 'utf8'),
) as { cases: StripCase[] };

describe('the shared strip table', () => {
  for (const c of table.cases) {
    test(c.name, () => {
      const once = sanitizeNoteInlineHtml(c.input);
      expect(once).toBe(c.output);
      // Idempotent: the backend may strip what the frontend already stripped.
      expect(sanitizeNoteInlineHtml(once)).toBe(once);
    });
  }
});

describe('hostile input', () => {
  test('a tag rebuilt by every removal still ends with no tag and is stable', () => {
    const hostile = '<'.repeat(40) + '<b>' + 'b>'.repeat(40) + 'x';
    const once = sanitizeNoteInlineHtml(hostile);
    expect(once).not.toMatch(/<b>/i);
    expect(sanitizeNoteInlineHtml(once)).toBe(once);
  });
});

describe('parseInlineHtmlTag', () => {
  test('reads one allowed tag as its canonical form', () => {
    expect(parseInlineHtmlTag('<span style="color:#e53935">')).toEqual({
      name: 'span',
      closing: false,
      canonical: '<span style="color:#E53935">',
    });
    expect(parseInlineHtmlTag('</MARK>')).toEqual({
      name: 'mark',
      closing: true,
      canonical: '</mark>',
    });
  });

  test('gives no canonical form to a disallowed span and nothing for other text', () => {
    expect(parseInlineHtmlTag('<span onclick="x">')?.canonical).toBeNull();
    expect(parseInlineHtmlTag('<div>')).toBeNull();
    expect(parseInlineHtmlTag('<span style="color:#E53935">x')).toBeNull();
  });
});

describe('prepareNewMarkdownContent', () => {
  test('accepts Markdown unchanged', () => {
    expect(prepareNewMarkdownContent('# 見出し')).toEqual({ ok: true, content: '# 見出し' });
  });

  test('strips only the disallowed parts of a mixed body', () => {
    expect(
      prepareNewMarkdownContent(
        '<span style="color:#E53935">赤</span><script>x</script><span onclick="y">z</span>',
      ),
    ).toEqual({ ok: true, content: '<span style="color:#E53935">赤</span>z' });
  });

  test('still refuses the old editor structure tags', () => {
    expect(prepareNewMarkdownContent('<span style="color:#E53935">a</span><div>b</div>')).toEqual({
      ok: false,
      reason: 'legacy_html',
    });
    expect(prepareNewMarkdownContent('<p>a</p>')).toEqual({ ok: false, reason: 'legacy_html' });
    expect(prepareNewMarkdownContent('a<br>b')).toEqual({ ok: false, reason: 'legacy_html' });
  });

  test('refuses a body past the limit', () => {
    expect(prepareNewMarkdownContent('a'.repeat(MAX_NOTE_CONTENT + 1))).toEqual({
      ok: false,
      reason: 'too_long',
    });
  });

  test('accepts an empty body', () => {
    expect(prepareNewMarkdownContent('')).toEqual({ ok: true, content: '' });
  });
});
