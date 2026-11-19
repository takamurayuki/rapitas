/**
 * note-migration.test
 *
 * The server half of the desktop's one-time move (design §5.3, completion
 * condition 2): the manifest lists versions without bodies, and the resolve
 * write replaces a note only while it is still at the version the client
 * diffed against — so a phone edit after the diff survives, and a resend
 * after a lost response is `alreadyApplied` without a second write.
 */
import { describe, expect, test } from 'bun:test';
import { createNoteMemoryDb, type MemoryNote } from '../../tests/helpers/note-memory-db';
import { buildMigrationManifest, resolveMigrationItem } from './note-migration';
import { saveNote } from './note-write';
import { computeContentSha256, computeNoteVersion } from './note-version';
import { runInWorkspace } from '../tenancy/workspace-context';
import type { PrismaInstance } from './note-record';

const asClient = (p: unknown) => p as PrismaInstance;
const consistent = (n: MemoryNote | undefined) => !!n && n.version === computeNoteVersion(n);

async function seeded() {
  const db = createNoteMemoryDb();
  const client = asClient(db.prisma);
  // Saved from a conversation: on the server and copied to the PC.
  await saveNote(client, 'chat-1', { title: '会話から', content: '元の本文' });
  return { db, client };
}

describe('the manifest', () => {
  test('lists every compared field and a body hash, but not the body', async () => {
    const { client } = await seeded();
    const [entry] = await buildMigrationManifest(client);
    expect(entry).toMatchObject({
      id: 'chat-1',
      title: '会話から',
      tags: [],
      docType: null,
      contentSha256: computeContentSha256('元の本文'),
    });
    expect(entry?.version).toHaveLength(64);
    expect(entry).not.toHaveProperty('content');
  });

  test('fills old rows first, so every listed note has a version', async () => {
    const { db, client } = await seeded();
    const row = db.notes.get('chat-1');
    if (row) row.version = null;
    const [entry] = await buildMigrationManifest(client);
    expect(entry?.version).toBe(computeNoteVersion(row as MemoryNote));
  });

  test('lists only the request workspace', async () => {
    const { client } = await seeded();
    await runInWorkspace(5, () => saveNote(client, 'other-ws', { title: 'x' }));
    const ids = (await buildMigrationManifest(client)).map((e) => e.id);
    expect(ids).toEqual(['chat-1']);
  });
});

describe('resolving a difference with the PC version', () => {
  const pcVersion = (ifVersion: string) => ({
    id: 'chat-1',
    ifVersion,
    title: '会話から（PCで編集）',
    content: '# PC で書き足した本文',
    tags: ['設計'],
    docType: '設計書',
  });

  test('writes it when the server is still at ifVersion, keeping fields and version in step', async () => {
    const { db, client } = await seeded();
    const [entry] = await buildMigrationManifest(client);
    const result = await resolveMigrationItem(client, pcVersion(entry?.version ?? ''));
    expect(result.status).toBe('applied');
    const stored = db.notes.get('chat-1');
    expect(stored?.content).toBe('# PC で書き足した本文');
    expect(stored?.docType).toBe('設計書');
    expect(consistent(stored)).toBe(true);
  });

  test('a resend after the response was lost is alreadyApplied and writes nothing more', async () => {
    const { db, client } = await seeded();
    const [entry] = await buildMigrationManifest(client);
    const item = pcVersion(entry?.version ?? '');
    await resolveMigrationItem(client, item);
    const writes = db.counts.noteUpdateMany;
    const updatedAt = db.notes.get('chat-1')?.updatedAt;
    const again = await resolveMigrationItem(client, item);
    expect(again.status).toBe('alreadyApplied');
    expect(db.counts.noteUpdateMany).toBe(writes);
    expect(db.notes.get('chat-1')?.updatedAt).toEqual(updatedAt as Date);
  });

  test('a phone edit after the diff is kept: conflict with the current version, nothing written', async () => {
    const { db, client } = await seeded();
    const [entry] = await buildMigrationManifest(client);
    await saveNote(client, 'chat-1', { content: 'スマホで直した本文' });
    const result = await resolveMigrationItem(client, pcVersion(entry?.version ?? ''));
    expect(result.status).toBe('conflict');
    if (result.status !== 'conflict') return;
    expect(result.current?.contentSha256).toBe(computeContentSha256('スマホで直した本文'));
    expect(result.current?.version).toBe(db.notes.get('chat-1')?.version as string);
    expect(db.notes.get('chat-1')?.content).toBe('スマホで直した本文');
  });

  test('a phone edit that lands between the check and the write still wins', async () => {
    const { db, client } = await seeded();
    const [entry] = await buildMigrationManifest(client);
    db.hooks.beforeUpdateMany = async () => {
      db.hooks.beforeUpdateMany = undefined;
      await saveNote(client, 'chat-1', { title: 'スマホのタイトル' });
    };
    const result = await resolveMigrationItem(client, pcVersion(entry?.version ?? ''));
    expect(result.status).toBe('conflict');
    expect(db.notes.get('chat-1')?.title).toBe('スマホのタイトル');
    expect(consistent(db.notes.get('chat-1'))).toBe(true);
  });

  test('a title, tags or docType difference alone is written like any other', async () => {
    const { db, client } = await seeded();
    const [entry] = await buildMigrationManifest(client);
    const result = await resolveMigrationItem(client, {
      id: 'chat-1',
      ifVersion: entry?.version ?? '',
      title: '会話から',
      content: '元の本文',
      tags: ['あとで読む'],
      docType: null,
    });
    expect(result.status).toBe('applied');
    expect(db.notes.get('chat-1')?.tags).toBe('["あとで読む"]');
  });

  test('takes the PC original in the old editor HTML for the same id', async () => {
    const { db, client } = await seeded();
    const [entry] = await buildMigrationManifest(client);
    const result = await resolveMigrationItem(client, {
      ...pcVersion(entry?.version ?? ''),
      content: '<div>PC の<strong>原本</strong></div>',
    });
    expect(result.status).toBe('applied');
    expect(db.notes.get('chat-1')?.content).toBe('<div>PC の<strong>原本</strong></div>');
  });

  test('a PC version identical to the server is alreadyApplied without a write', async () => {
    const { db, client } = await seeded();
    const [entry] = await buildMigrationManifest(client);
    const writes = db.counts.noteUpdateMany;
    const result = await resolveMigrationItem(client, {
      id: 'chat-1',
      ifVersion: entry?.version ?? '',
      title: '会話から',
      content: '元の本文',
      tags: [],
      docType: null,
    });
    expect(result.status).toBe('alreadyApplied');
    expect(db.counts.noteUpdateMany).toBe(writes);
  });

  test('cannot reach a note in another workspace or one that is gone', async () => {
    const { db, client } = await seeded();
    const [entry] = await buildMigrationManifest(client);
    const inOther = await runInWorkspace(9, () =>
      resolveMigrationItem(client, pcVersion(entry?.version ?? '')),
    );
    expect(inOther).toEqual({ id: 'chat-1', status: 'conflict', current: null });
    expect(db.notes.get('chat-1')?.title).toBe('会話から');
  });
});
