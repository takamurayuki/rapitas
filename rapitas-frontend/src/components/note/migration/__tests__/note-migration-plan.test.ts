/**
 * note-migration-plan.test
 *
 * The diff compares what the server would store: the body hash must be the
 * server's `contentSha256` (Node's SHA-256 of the UTF-8 bytes), and a local
 * note is trimmed and bounded the same way before it is compared or sent.
 * A `{id}-pc` candidate (a write whose response was lost) is this browser's
 * copy only while the server copy has exactly the signature that was sent.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  matchingPendingCopies,
  normalizeLocalNote,
  planMigration,
  sha256Hex,
  type ManifestEntry,
} from '../note-migration-plan';
import { fakeHash } from './fake-note-server';

const entry = (id: string, content: string): ManifestEntry => ({
  id,
  updatedAt: '2026-11-10T00:00:00Z',
  version: `v:${id}:${content}`,
  title: 't',
  tags: [],
  docType: null,
  contentSha256: `h:${content}`,
  linkedTaskIds: [],
});
const signature = (content: string) => JSON.stringify(['t', `h:${content}`, [], null]);
const localX = {
  id: 'x',
  title: 't',
  content: '編集後の PC',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-11-15T00:00:00Z'),
  isPinned: false,
  tags: [],
};

describe('a candidate copy whose response was lost', () => {
  const manifest = [entry('x', 'サーバー'), entry('x-pc', '送った PC')];

  it("is this browser's older copy when the server copy has the sent content", async () => {
    const plan = await planMigration(
      [localX],
      manifest,
      {},
      fakeHash,
      [],
      {},
      {
        x: signature('送った PC'),
      },
    );
    expect(plan.diffs.map((d) => [d.copyUnavailable, d.staleCopyVersion])).toEqual([
      [false, 'v:x-pc:送った PC'],
    ]);
  });

  it("does not make a copy with other content this browser's", async () => {
    const plan = await planMigration(
      [localX],
      manifest,
      {},
      fakeHash,
      [],
      {},
      {
        x: signature('別の内容'),
      },
    );
    expect(plan.diffs.map((d) => [d.copyUnavailable, d.staleCopyVersion])).toEqual([[true, null]]);
  });

  it('is kept only while the server copy has the sent content', () => {
    expect(
      matchingPendingCopies(
        { x: signature('送った PC'), y: signature('送った PC'), z: signature('届かず') },
        [...manifest, entry('z-pc', '旧内容')],
      ),
    ).toEqual({ x: signature('送った PC') });
  });
});

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
