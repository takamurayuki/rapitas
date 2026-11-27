/**
 * note-content-kind.test
 *
 * The save-time body rules (design §5.3). The verdict table is shared with
 * the frontend's note-content-kind.test.ts through
 * note-content-kind.cases.json, so both sides are held to the same answers.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkNewMarkdownContent,
  isLegacyEditorHtml,
  splitByCode,
  withoutCode,
} from './note-content-kind';
import { MAX_NOTE_CONTENT } from './note-limits';

interface ContentCase {
  name: string;
  content: string;
  legacyHtml: boolean;
}

const table = JSON.parse(
  readFileSync(join(import.meta.dir, 'note-content-kind.cases.json'), 'utf8'),
) as { cases: ContentCase[] };

describe('the shared verdict table', () => {
  test('has the inputs the design names', () => {
    const names = table.cases.map((c) => c.name);
    for (const required of [
      'empty',
      'one plain line',
      'several plain lines',
      'entity references only',
      'tag inside a fence',
      'tag inside inline code',
      'editor div and br',
    ]) {
      expect(names).toContain(required);
    }
  });

  for (const c of table.cases) {
    test(`${c.name}: legacy HTML is ${c.legacyHtml}, new Markdown accepted is ${!c.legacyHtml}`, () => {
      expect(isLegacyEditorHtml(c.content)).toBe(c.legacyHtml);
      expect(checkNewMarkdownContent(c.content)).toBe(c.legacyHtml ? 'legacy_html' : null);
    });
  }
});

describe('the new Markdown check', () => {
  test('accepts a body at the limit and refuses one past it', () => {
    expect(checkNewMarkdownContent('a'.repeat(MAX_NOTE_CONTENT))).toBeNull();
    expect(checkNewMarkdownContent('a'.repeat(MAX_NOTE_CONTENT + 1))).toBe('too_long');
  });
});

// The same tag list the save check uses (EDITOR_HTML_TAG, minus the allowed
// inline forms span / u / mark).
const EDITOR_TAG =
  /<\/?(p|div|br|font|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|pre|code|blockquote|strong|b|em|i|s|strike|a|img|hr)(\s[^<>]*)?\/?>/i;

describe('splitByCode', () => {
  for (const c of table.cases) {
    test(`${c.name}: the pieces rebuild the body and agree with withoutCode`, () => {
      const segments = splitByCode(c.content);
      expect(segments.map((s) => s.text).join('')).toBe(c.content);
      const prose = segments.map((s) => (s.code ? ' ' : s.text)).join('');
      const verdict = c.content.trim() !== '' && EDITOR_TAG.test(prose);
      expect(verdict).toBe(c.legacyHtml);
      expect(verdict).toBe(c.content.trim() !== '' && EDITOR_TAG.test(withoutCode(c.content)));
    });
  }

  test('keeps every kind of line break as it was', () => {
    const body = 'a\r\nb\rc\n\n```\r\nx\r\n```\r\nd';
    expect(
      splitByCode(body)
        .map((s) => s.text)
        .join(''),
    ).toBe(body);
  });

  test('puts a blank line, a fence and a heading in blocks of their own', () => {
    const segments = splitByCode('a `x` b\n\n# h\nc\n```\nz\n```');
    const blockOf = (text: string) => segments.find((s) => s.text.includes(text))?.block;
    expect(blockOf('a ')).toBe(blockOf(' b'));
    expect(blockOf('`x`')).toBe(blockOf('a '));
    expect(blockOf('# h')).not.toBe(blockOf('a '));
    expect(blockOf('c')).not.toBe(blockOf('# h'));
    expect(segments.find((s) => s.text.includes('z'))?.code).toBe(true);
  });
});
