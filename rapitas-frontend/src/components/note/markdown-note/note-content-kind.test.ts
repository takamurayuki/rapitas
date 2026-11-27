/**
 * note-content-kind.test
 *
 * The frontend copy of the save-time body rules gives the same verdict as
 * the backend for every row of the shared table (design §5.3: 同じ入力の表で
 * 同じ判定になることを両側のテストで確かめる).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkNewMarkdownContent,
  isLegacyEditorHtml,
  MAX_NOTE_CONTENT,
  prepareNewMarkdownContent,
} from './note-content-kind';
import { withoutCode } from './note-content-format';
import { splitByCode } from './inline-html';

interface ContentCase {
  name: string;
  content: string;
  legacyHtml: boolean;
}

// The backend owns the table; the frontend reads it rather than copying it.
const TABLE_PATH = resolve(
  __dirname,
  '../../../../../rapitas-backend/services/notes/note-content-kind.cases.json',
);
const table = JSON.parse(readFileSync(TABLE_PATH, 'utf8')) as { cases: ContentCase[] };

describe('the shared verdict table', () => {
  it('is the backend table, with the inputs the design names', () => {
    expect(table.cases.length).toBeGreaterThanOrEqual(10);
    expect(table.cases.map((c) => c.name)).toContain('editor div and br');
  });

  for (const c of table.cases) {
    it(`${c.name}: legacy HTML is ${c.legacyHtml}`, () => {
      expect(isLegacyEditorHtml(c.content)).toBe(c.legacyHtml);
      expect(checkNewMarkdownContent(c.content)).toBe(c.legacyHtml ? 'legacy_html' : null);
    });
  }
});

describe('the new Markdown check', () => {
  it('accepts a body at the limit and refuses one past it', () => {
    expect(checkNewMarkdownContent('a'.repeat(MAX_NOTE_CONTENT))).toBeNull();
    expect(checkNewMarkdownContent('a'.repeat(MAX_NOTE_CONTENT + 1))).toBe('too_long');
  });
});

// EDITOR_HTML_TAG without the allowed inline forms span / u / mark.
const EDITOR_TAG =
  /<\/?(p|div|br|font|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|pre|code|blockquote|strong|b|em|i|s|strike|a|img|hr)(\s[^<>]*)?\/?>/i;

describe('splitByCode', () => {
  for (const c of table.cases) {
    it(`${c.name}: the pieces rebuild the body and agree with withoutCode`, () => {
      const segments = splitByCode(c.content);
      expect(segments.map((s) => s.text).join('')).toBe(c.content);
      const prose = segments.map((s) => (s.code ? ' ' : s.text)).join('');
      const verdict = c.content.trim() !== '' && EDITOR_TAG.test(prose);
      expect(verdict).toBe(c.legacyHtml);
      expect(verdict).toBe(c.content.trim() !== '' && EDITOR_TAG.test(withoutCode(c.content)));
    });
  }

  it('keeps every kind of line break as it was', () => {
    const body = 'a\r\nb\rc\n\n```\r\nx\r\n```\r\nd';
    expect(
      splitByCode(body)
        .map((s) => s.text)
        .join(''),
    ).toBe(body);
  });
});

describe('prepareNewMarkdownContent', () => {
  it('strips only the disallowed parts of a mixed body', () => {
    expect(
      prepareNewMarkdownContent(
        '<span style="color:#E53935">赤</span><script>x</script><span onclick="y">z</span>',
      ),
    ).toEqual({ ok: true, content: '<span style="color:#E53935">赤</span>z' });
  });

  it('still refuses the old editor structure tags and an over-long body', () => {
    expect(prepareNewMarkdownContent('<span style="color:#E53935">a</span><div>b</div>')).toEqual({
      ok: false,
      reason: 'legacy_html',
    });
    expect(prepareNewMarkdownContent('a'.repeat(MAX_NOTE_CONTENT + 1))).toEqual({
      ok: false,
      reason: 'too_long',
    });
  });
});
