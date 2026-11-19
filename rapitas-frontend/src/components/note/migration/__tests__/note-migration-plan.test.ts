/**
 * note-migration-plan.test
 *
 * The diff compares what the server would store: the body hash must be the
 * server's `contentSha256` (Node's SHA-256 of the UTF-8 bytes), and a local
 * note is trimmed and bounded the same way before it is compared or sent.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { normalizeLocalNote, sha256Hex } from '../note-migration-plan';

describe('the body hash', () => {
  it('matches the server for Japanese text, emoji-free symbols and an empty body', async () => {
    for (const text of ['元の本文', '# 見出し\n\n- a & b', '']) {
      const server = createHash('sha256').update(text, 'utf8').digest('hex');
      expect(await sha256Hex(text)).toBe(server);
    }
  });
});

describe('normalizing a local note', () => {
  it('trims tags, drops empty ones and maps a missing type to null', () => {
    const n = normalizeLocalNote({
      id: 'a',
      title: 't',
      content: 'c',
      createdAt: new Date(),
      updatedAt: new Date(),
      isPinned: false,
      tags: [' x ', '', 'y'],
    });
    expect(n).toEqual({
      id: 'a',
      title: 't',
      content: 'c',
      tags: ['x', 'y'],
      docType: null,
      isPinned: false,
    });
  });
});
