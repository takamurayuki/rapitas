/**
 * note-migration-runner.keep-both.test
 *
 * "Keep both" when the PC note is edited after the difference list was shown
 * (completion condition 2): the old, shown version must not take `{id}-pc`
 * and so lock "keep both" out for the edited version. The user must still be
 * able to keep the edited PC version and the server version side by side.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Note } from '@/stores/note/note-types';
import { INITIAL_RECORD, type MigrationRecord } from '@/stores/note/note-migration-record';
import { applyDecisions, runMigration, type RunDeps } from '../note-migration-runner';
import { createFakeNoteServer, fakeHash } from './fake-note-server';

let record: MigrationRecord;
let localList: Note[];
let completed: number;

const records = {
  read: () => record,
  write: (next: MigrationRecord) => (record = next),
};

const editLocal = (id: string, content: string) => {
  localList = localList.map((n) =>
    n.id === id ? { ...n, content, updatedAt: new Date('2026-11-19T12:00:00Z') } : n,
  );
};

beforeEach(() => {
  record = { ...INITIAL_RECORD, backedUpAt: '2026-11-19T00:00:00Z' };
  completed = 0;
});

const depsFor = (server: ReturnType<typeof createFakeNoteServer>): RunDeps => ({
  api: server.api,
  records,
  readLocal: () => localList,
  hash: fakeHash,
  onComplete: () => {
    completed += 1;
  },
});

function shown() {
  const server = createFakeNoteServer();
  server.put('x', { title: 't-x', content: 'サーバー' });
  localList = [
    {
      id: 'x',
      title: 't-x',
      content: '表示時点の PC',
      createdAt: new Date('2026-10-01T00:00:00Z'),
      updatedAt: new Date('2026-11-15T00:00:00Z'),
      isPinned: false,
      tags: [],
    },
  ];
  return server;
}

/** Run `during` once, right after the first import call has landed. */
function afterFirstImport(server: ReturnType<typeof createFakeNoteServer>, during: () => void) {
  const real = server.api.importNotes;
  let fired = false;
  server.api.importNotes = async (batch) => {
    const result = await real(batch);
    if (!fired) {
      fired = true;
      during();
    }
    return result;
  };
}

describe('"keep both" after the PC note was edited past the shown version', () => {
  it('does not copy the shown version, asks again, and keeps the edit and the server', async () => {
    const server = shown();
    const first = await runMigration(depsFor(server));
    if (first.status !== 'needsDecision') throw new Error('expected a difference');
    editLocal('x', '表示の後の PC');

    const after = await applyDecisions(depsFor(server), first.diffs, { x: 'both' });
    expect(after.status).toBe('needsDecision');
    if (after.status !== 'needsDecision') return;
    expect(after.diffs.map((d) => [d.id, d.local.content, d.copyUnavailable])).toEqual([
      ['x', '表示の後の PC', false],
    ]);
    expect(server.notes.has('x-pc')).toBe(false);
    expect(completed).toBe(0);

    const done = await applyDecisions(depsFor(server), after.diffs, { x: 'both' });
    expect(done.status).toBe('done');
    expect(server.notes.get('x-pc')?.content).toBe('表示の後の PC');
    expect(server.notes.get('x')?.content).toBe('サーバー');
    expect(completed).toBe(1);
  });

  it('replaces its own older copy when the edit lands while the copy is written', async () => {
    const server = shown();
    const first = await runMigration(depsFor(server));
    if (first.status !== 'needsDecision') throw new Error('expected a difference');
    afterFirstImport(server, () => editLocal('x', '書き込み中の編集'));

    const after = await applyDecisions(depsFor(server), first.diffs, { x: 'both' });
    expect(after.status).toBe('needsDecision');
    if (after.status !== 'needsDecision') return;
    expect(server.notes.get('x-pc')?.content).toBe('表示時点の PC');
    // The copy is this run's own older one, so it does not lock "both" out.
    expect(after.diffs.map((d) => [d.id, d.local.content, d.copyUnavailable])).toEqual([
      ['x', '書き込み中の編集', false],
    ]);

    const done = await applyDecisions(depsFor(server), after.diffs, { x: 'both' });
    expect(done.status).toBe('done');
    expect(server.notes.get('x-pc')?.content).toBe('書き込み中の編集');
    expect(server.notes.get('x')?.content).toBe('サーバー');
    // Replaced in place, not a second copy.
    expect(server.creates).toBe(1);
  });

  it('does not replace its older copy once someone else has edited that copy', async () => {
    const server = shown();
    const first = await runMigration(depsFor(server));
    if (first.status !== 'needsDecision') throw new Error('expected a difference');
    afterFirstImport(server, () => editLocal('x', '書き込み中の編集'));
    await applyDecisions(depsFor(server), first.diffs, { x: 'both' });
    server.put('x-pc', { content: 'スマホで直した写し' });

    const again = await runMigration(depsFor(server));
    expect(again.status).toBe('needsDecision');
    if (again.status !== 'needsDecision') return;
    expect(again.diffs[0]?.copyUnavailable).toBe(true);
    await applyDecisions(depsFor(server), again.diffs, { x: 'both' });
    expect(server.notes.get('x-pc')?.content).toBe('スマホで直した写し');
  });
});
