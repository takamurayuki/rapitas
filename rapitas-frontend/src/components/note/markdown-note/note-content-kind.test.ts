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
import { checkNewMarkdownContent, isLegacyEditorHtml, MAX_NOTE_CONTENT } from './note-content-kind';

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
