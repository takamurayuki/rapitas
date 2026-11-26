/**
 * note-inline-html.test
 *
 * The frontend copy of the save-time inline HTML strip gives the same output
 * as the backend for every row of the shared table
 * (rapitas-backend/services/notes/inline-html/note-inline-html.cases.json).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInlineHtmlTag, sanitizeNoteInlineHtml } from './index';

interface StripCase {
  name: string;
  input: string;
  output: string;
}

// The backend owns the table; the frontend reads it rather than copying it.
const TABLE_PATH = resolve(
  __dirname,
  '../../../../../../rapitas-backend/services/notes/inline-html/note-inline-html.cases.json',
);
const table = JSON.parse(readFileSync(TABLE_PATH, 'utf8')) as { cases: StripCase[] };

describe('the shared strip table', () => {
  it('is the backend table', () => {
    expect(table.cases.length).toBeGreaterThanOrEqual(40);
    expect(table.cases.map((c) => c.name)).toContain('script is removed with its content');
  });

  for (const c of table.cases) {
    it(c.name, () => {
      const once = sanitizeNoteInlineHtml(c.input);
      expect(once).toBe(c.output);
      expect(sanitizeNoteInlineHtml(once)).toBe(once);
    });
  }
});

describe('parseInlineHtmlTag', () => {
  it('reads an allowed tag as its canonical form and refuses the rest', () => {
    expect(parseInlineHtmlTag("<span style='font-size: 24px;'>")?.canonical).toBe(
      '<span style="font-size:24px">',
    );
    expect(parseInlineHtmlTag('<span onclick="x">')?.canonical).toBeNull();
    expect(parseInlineHtmlTag('<div>')).toBeNull();
  });
});
