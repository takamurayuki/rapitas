/**
 * note-migration-runner.test
 *
 * The desktop note migration as a whole, against an in-memory server with
 * the backend's semantics (completion conditions 2 and 3): every note the
 * server lacks, every difference as chosen and every missing link ends up on
 * the server; the server's own meta is not rewritten; and a migration cut
 * off anywhere — a dropped connection, a lost response — finishes on the
 * next run with nothing duplicated and nothing missing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Note } from '@/stores/note/note-types';
import { INITIAL_RECORD, type MigrationRecord } from '@/stores/note/note-migration-record';
import { applyDecisions, runMigration, type RunDeps } from '../note-migration-runner';
import { createFakeNoteServer, fakeHash } from './fake-note-server';

let record: MigrationRecord;
const records = {
  read: () => record,
  write: (next: MigrationRecord) => (record = next),
};

const local = (id: string, over: Partial<Note> = {}): Note => ({
  id,
  title: `t-${id}`,
  content: `c-${id}`,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-11-15T00:00:00Z'),
  isPinned: false,
  tags: [],
  ...over,
});

beforeEach(() => {
  record = { ...INITIAL_RECORD, backedUpAt: '2026-11-19T00:00:00Z' };
});

const depsFor = (server: ReturnType<typeof createFakeNoteServer>, localNotes: Note[]): RunDeps => ({
  api: server.api,
  records,
  localNotes,
  hash: fakeHash,
});

describe('a mixed browser store', () => {
  function scenario() {
    const server = createFakeNoteServer();
    // Saved from a chat: on the server, then edited on the PC.
    server.put('chat', { title: '会話', content: '元の本文' });
    server.put('same', { title: 't-same', content: 'c-same' });
    server.put('title-only', { title: 'サーバーのタイトル', content: 'c-title-only' });
    server.put('tags-only', { title: 't-tags-only', content: 'c-tags-only', tags: ['server'] });
    server.put('type-only', { title: 't-type-only', content: 'c-type-only', docType: null });
    server.put('html', { title: 't-html', content: '# Markdown 版' });
    // The phone linked "chat" to task 8 with its own meta.
    server.links.set('chat:8', { themeName: 'スマホのテーマ', projectName: 'P' });
    const notes = [
      local('new', {
        linkedTaskIds: [7, 70],
        linkedTaskMeta: { 7: { taskTitle: 'T7', themeName: 'Th', categoryName: 'C' } },
      }),
      local('chat', {
        title: '会話',
        content: '元の本文＋PC で書き足し',
        linkedTaskIds: [8],
        linkedTaskMeta: { 8: { taskTitle: 'T8', themeName: 'PC の古いテーマ', categoryName: 'C' } },
      }),
      local('same'),
      local('title-only', { updatedAt: new Date('2026-01-01T00:00:00Z') }),
      local('tags-only', { tags: ['pc'] }),
      local('type-only', { docType: '設計書' }),
      local('html', { content: '<div>PC の<b>原本</b></div>' }),
      local('blank', { title: '', content: '' }),
    ];
    return { server, notes };
  }

  it('imports the new note, links what is missing and lists exactly the differences', async () => {
    const { server, notes } = scenario();
    const result = await runMigration(depsFor(server, notes));
    expect(result.status).toBe('needsDecision');
    if (result.status !== 'needsDecision') return;
    const byId = Object.fromEntries(result.diffs.map((d) => [d.id, d]));
    expect(Object.keys(byId).sort()).toEqual([
      'chat',
      'html',
      'tags-only',
      'title-only',
      'type-only',
    ]);
    expect(byId['chat']?.fields).toEqual(['content']);
    expect(byId['title-only']?.fields).toEqual(['title']);
    expect(byId['tags-only']?.fields).toEqual(['tags']);
    expect(byId['type-only']?.fields).toEqual(['docType']);
    expect(byId['html']?.localIsLegacyHtml).toBe(true);
    // Newer side by default: the PC edit is newer, the old PC title is not.
    expect(byId['chat']?.defaultChoice).toBe('pc');
    expect(byId['title-only']?.defaultChoice).toBe('server');

    expect(server.notes.has('new')).toBe(true);
    expect(server.notes.has('blank')).toBe(false);
    expect(server.links.get('new:7')).toEqual({
      taskTitle: 'T7',
      themeName: 'Th',
      categoryName: 'C',
    });
    // The phone's meta stays; only its empty keys are filled.
    expect(server.links.get('chat:8')).toEqual({
      themeName: 'スマホのテーマ',
      projectName: 'P',
      taskTitle: 'T8',
      categoryName: 'C',
    });
    expect(record.rejectedLinks).toEqual([{ noteId: 'new', taskId: 70, error: 'task_not_found' }]);
    expect(record.phase).toBe('resolving');
  });

  it('writes the differences as chosen and finishes', async () => {
    const { server, notes } = scenario();
    const first = await runMigration(depsFor(server, notes));
    if (first.status !== 'needsDecision') throw new Error('expected differences');
    const done = await applyDecisions(depsFor(server, notes), first.diffs, {
      chat: 'pc',
      'title-only': 'server',
      'tags-only': 'both',
      'type-only': 'pc',
      html: 'pc',
    });
    expect(done.status).toBe('done');
    expect(server.notes.get('chat')?.content).toBe('元の本文＋PC で書き足し');
    expect(server.notes.get('title-only')?.title).toBe('サーバーのタイトル');
    expect(server.notes.get('tags-only')?.tags).toEqual(['server']);
    expect(server.notes.get('tags-only-pc')?.tags).toEqual(['pc']);
    expect(server.notes.get('type-only')?.docType).toBe('設計書');
    expect(server.notes.get('html')?.content).toBe('<div>PC の<b>原本</b></div>');
    expect(record.phase).toBe('done');
    // Running again finds nothing to do and asks nothing.
    const again = await runMigration(depsFor(server, notes));
    expect(again.status).toBe('done');
  });

  it('shows a difference again when the phone edits it after the diff, then writes it', async () => {
    const { server, notes } = scenario();
    const first = await runMigration(depsFor(server, notes));
    if (first.status !== 'needsDecision') throw new Error('expected differences');
    server.put('chat', { title: 'スマホで改題' });
    const after = await applyDecisions(depsFor(server, notes), first.diffs, { chat: 'pc' });
    expect(after.status).toBe('needsDecision');
    if (after.status !== 'needsDecision') return;
    const chat = after.diffs.find((d) => d.id === 'chat');
    expect(chat?.server.title).toBe('スマホで改題');
    expect(chat?.fields).toEqual(['title', 'content']);
    expect(server.notes.get('chat')?.title).toBe('スマホで改題');
    const done = await applyDecisions(depsFor(server, notes), after.diffs, { chat: 'pc' });
    expect(done.status).toBe('done');
    expect(server.notes.get('chat')?.title).toBe('会話');
  });
});

describe('more than one chunk', () => {
  const many = Array.from({ length: 1203 }, (_, i) => local(`n${i}`));

  it('sends 500 at a time and takes in all of them', async () => {
    const server = createFakeNoteServer();
    const result = await runMigration(depsFor(server, many));
    expect(result.status).toBe('done');
    expect(server.calls.importNotes).toBe(3);
    expect(server.notes.size).toBe(1203);
    expect(record.imported).toBe(1203);
  });

  it('resumes a run cut off mid-import with nothing duplicated or missing', async () => {
    const server = createFakeNoteServer();
    // The first chunk goes through; the connection drops on the second.
    const realImport = server.api.importNotes;
    let n = 0;
    server.api.importNotes = async (batch) => {
      n += 1;
      if (n === 2) throw new Error('connection cut');
      return realImport(batch);
    };
    await expect(runMigration(depsFor(server, many))).rejects.toThrow('connection cut');
    expect(record.phase).toBe('importing');
    expect(record.imported).toBe(500);
    expect(server.notes.size).toBe(500);
    server.api.importNotes = realImport;
    const result = await runMigration(depsFor(server, many));
    expect(result.status).toBe('done');
    expect(server.notes.size).toBe(1203);
    expect(server.creates).toBe(1203);
    expect(record.phase).toBe('done');
  });

  it('resumes after the link import response was lost, adding each link once', async () => {
    const server = createFakeNoteServer();
    const linked = many.slice(0, 3).map((n) => ({ ...n, linkedTaskIds: [7] }));
    server.failNext('importLinks', 'after');
    await expect(runMigration(depsFor(server, linked))).rejects.toThrow();
    expect(record.phase).toBe('linking');
    const result = await runMigration(depsFor(server, linked));
    expect(result.status).toBe('done');
    expect([...server.links.keys()].sort()).toEqual(['n0:7', 'n1:7', 'n2:7']);
  });
});

describe('a resolve whose response was lost', () => {
  it('does not write twice: the resend is alreadyApplied and the run finishes', async () => {
    const server = createFakeNoteServer();
    server.put('chat', { title: '会話', content: '元' });
    const notes = [local('chat', { title: '会話', content: 'PC 版' })];
    const first = await runMigration(depsFor(server, notes));
    if (first.status !== 'needsDecision') throw new Error('expected a difference');
    server.failNext('resolve', 'after');
    await expect(
      applyDecisions(depsFor(server, notes), first.diffs, { chat: 'pc' }),
    ).rejects.toThrow();
    expect(server.notes.get('chat')?.content).toBe('PC 版');
    const writtenAt = server.notes.get('chat')?.updatedAt;
    // Resend exactly what was sent.
    const resend = await server.api.resolve([
      {
        id: 'chat',
        ifVersion: first.diffs[0]?.server.version ?? '',
        title: '会話',
        content: 'PC 版',
        tags: [],
        docType: null,
      },
    ]);
    expect(resend).toEqual([{ id: 'chat', status: 'alreadyApplied' }]);
    expect(server.notes.get('chat')?.updatedAt).toBe(writtenAt);
    // And the interrupted migration, resumed, finds nothing left to ask.
    expect((await runMigration(depsFor(server, notes))).status).toBe('done');
  });

  it('keeps a "server" choice across a resume instead of asking again', async () => {
    const server = createFakeNoteServer();
    server.put('a', { title: 'サーバー', content: 'x' });
    server.put('b', { title: 'サーバー', content: 'y' });
    const notes = [local('a', { content: 'pc' }), local('b', { content: 'pc' })];
    const first = await runMigration(depsFor(server, notes));
    if (first.status !== 'needsDecision') throw new Error('expected differences');
    server.failNext('resolve', 'before');
    await expect(
      applyDecisions(depsFor(server, notes), first.diffs, { a: 'server', b: 'pc' }),
    ).rejects.toThrow();
    const resumed = await runMigration(depsFor(server, notes));
    expect(resumed.status).toBe('needsDecision');
    if (resumed.status !== 'needsDecision') return;
    expect(resumed.diffs.map((d) => d.id)).toEqual(['b']);
  });
});
