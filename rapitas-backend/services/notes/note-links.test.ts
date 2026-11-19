/**
 * note-links.test
 *
 * Links stay inside the request's workspace (completion condition 5), and
 * the migration's link import adds what is missing without rewriting the
 * server's meta (completion condition 2: "a note the phone linked").
 */
import { describe, expect, test } from 'bun:test';
import { createNoteMemoryDb } from '../../tests/helpers/note-memory-db';
import { importNoteLinks, linkNoteInScope } from './note-links';
import { saveNote } from './note-write';
import { runInWorkspace } from '../tenancy/workspace-context';
import type { PrismaInstance } from './note-record';

const asClient = (p: unknown) => p as PrismaInstance;

async function seeded() {
  const db = createNoteMemoryDb({
    tasks: [
      { id: 7, workspaceId: null },
      { id: 70, workspaceId: 2 },
    ],
  });
  const client = asClient(db.prisma);
  await saveNote(client, 'n1', { title: 'ノート' });
  await runInWorkspace(2, () => saveNote(client, 'ws2-note', { title: 'ws2' }));
  return { db, client };
}

describe('linking from a task', () => {
  test('links a task in the same workspace, keeping only known meta keys', async () => {
    const { db, client } = await seeded();
    const meta = { taskTitle: '単元1', categoryName: '学習', themeName: '' };
    expect(await linkNoteInScope(client, 'n1', 7, meta)).toBeNull();
    expect(db.links[0]?.meta).toBe('{"taskTitle":"単元1","categoryName":"学習"}');
  });

  test('refuses a task in another workspace as task_not_found, writing nothing', async () => {
    const { db, client } = await seeded();
    expect(await linkNoteInScope(client, 'n1', 70)).toBe('task_not_found');
    expect(await linkNoteInScope(client, 'n1', 999)).toBe('task_not_found');
    expect(db.links).toHaveLength(0);
  });

  test('a scoped request cannot reach the NULL partition either way', async () => {
    const { db, client } = await seeded();
    expect(await runInWorkspace(2, () => linkNoteInScope(client, 'ws2-note', 7))).toBe(
      'task_not_found',
    );
    expect(await runInWorkspace(2, () => linkNoteInScope(client, 'n1', 70))).toBe('note_not_found');
    expect(await runInWorkspace(2, () => linkNoteInScope(client, 'ws2-note', 70))).toBeNull();
    expect(db.links).toHaveLength(1);
  });
});

describe('importing the browser links', () => {
  test('adds a missing link and fills only the empty meta keys of an existing one', async () => {
    const { db, client } = await seeded();
    await saveNote(client, 'n2', { title: 'スマホで紐付け' });
    // The phone linked n2 to task 7 with its own (newer) meta.
    await linkNoteInScope(client, 'n2', 7, { themeName: 'スマホのテーマ', projectName: 'P' });
    const results = await importNoteLinks(client, [
      { noteId: 'n1', taskId: 7, meta: { taskTitle: 'T', themeName: 'PC', categoryName: 'C' } },
      {
        noteId: 'n2',
        taskId: 7,
        meta: { taskTitle: 'T', themeName: 'PC の古いテーマ', categoryName: 'C' },
      },
    ]);
    expect(results.map((r) => r.status)).toEqual(['added', 'filled']);
    const n2 = JSON.parse(db.links.find((l) => l.noteId === 'n2')?.meta ?? '{}');
    expect(n2).toEqual({
      themeName: 'スマホのテーマ',
      projectName: 'P',
      taskTitle: 'T',
      categoryName: 'C',
    });
  });

  test('sending the same links again changes nothing', async () => {
    const { db, client } = await seeded();
    const items = [{ noteId: 'n1', taskId: 7, meta: { taskTitle: 'T' } }];
    await importNoteLinks(client, items);
    const again = await importNoteLinks(client, items);
    expect(again[0]?.status).toBe('unchanged');
    expect(db.links).toHaveLength(1);
  });

  test('refuses links to another workspace or a missing task as 404 and keeps going', async () => {
    const { db, client } = await seeded();
    const results = await importNoteLinks(client, [
      { noteId: 'n1', taskId: 70 },
      { noteId: 'n1', taskId: 404 },
      { noteId: 'gone', taskId: 7 },
      { noteId: 'n1', taskId: 7 },
    ]);
    expect(results).toEqual([
      { noteId: 'n1', taskId: 70, status: 'rejected', code: 404, error: 'task_not_found' },
      { noteId: 'n1', taskId: 404, status: 'rejected', code: 404, error: 'task_not_found' },
      { noteId: 'gone', taskId: 7, status: 'rejected', code: 404, error: 'note_not_found' },
      { noteId: 'n1', taskId: 7, status: 'added' },
    ]);
    expect(db.links).toHaveLength(1);
  });
});
