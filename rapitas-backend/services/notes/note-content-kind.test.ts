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
import { checkNewMarkdownContent, isLegacyEditorHtml } from './note-content-kind';
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
