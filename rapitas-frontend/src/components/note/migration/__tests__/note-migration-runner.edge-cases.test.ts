/**
 * note-migration-runner.edge-cases.test
 *
 * The cases where the migration must NOT call itself done (completion
 * conditions 2 and 3): a PC note created or edited while the run is going,
 * a PC note edited after the difference list was shown, a note whose id
 * another workspace holds, and a "keep both" whose `{id}-pc` is taken by
 * other content — plus a "keep both" whose response was lost, which a resume
 * must recognise from the server's copy instead of asking again.
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

/** A local edit, as the still-local store would write it. */
const editLocal = (id: string, over: Partial<Note>) => {
  localList = localList.map((n) =>
    n.id === id ? { ...n, ...over, updatedAt: new Date('2026-11-19T12:00:00Z') } : n,
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

/** Run `during` once, inside the first call of an API method. */
function duringFirst(
  server: ReturnType<typeof createFakeNoteServer>,
  method: 'importNotes' | 'importLinks',
  during: () => void,
) {
  const real = server.api[method] as (arg: never) => Promise<unknown>;
  let fired = false;
  (server.api as unknown as Record<string, unknown>)[method] = async (arg: never) => {
    const result = await real(arg);
    if (!fired) {
      fired = true;
      during();
    }
    return result;
  };
}

describe('PC notes that change while the migration runs', () => {
  it('takes in a note created during the import before calling itself done', async () => {
    const server = createFakeNoteServer();
    localList = [local('a')];
    duringFirst(server, 'importNotes', () => localList.push(local('b')));
    const result = await runMigration(depsFor(server));
    expect(result.status).toBe('done');
    expect([...server.notes.keys()].sort()).toEqual(['a', 'b']);
    expect(completed).toBe(1);
  });

  it('takes in a link added during the link step before calling itself done', async () => {
    const server = createFakeNoteServer();
    localList = [local('a', { linkedTaskIds: [8] })];
    duringFirst(server, 'importLinks', () => editLocal('a', { linkedTaskIds: [8, 7] }));
    const result = await runMigration(depsFor(server));
    expect(result.status).toBe('done');
    expect([...server.links.keys()].sort()).toEqual(['a:7', 'a:8']);
  });

  it('lists a note edited during the import as a difference instead of finishing', async () => {
    const server = createFakeNoteServer();
    localList = [local('a')];
    duringFirst(server, 'importNotes', () => editLocal('a', { content: '取り込み中の編集' }));
    const result = await runMigration(depsFor(server));
    expect(result.status).toBe('needsDecision');
    if (result.status !== 'needsDecision') return;
    expect(result.diffs.map((d) => [d.id, d.fields, d.defaultChoice])).toEqual([
      ['a', ['content'], 'pc'],
    ]);
    expect(record.phase).toBe('resolving');
    expect(completed).toBe(0);
    const done = await applyDecisions(depsFor(server), result.diffs, {});
    expect(done.status).toBe('done');
    expect(server.notes.get('a')?.content).toBe('取り込み中の編集');
  });
});

describe('a PC note edited after the difference list was shown', () => {
  function shown() {
    const server = createFakeNoteServer();
    server.put('x', { title: 't-x', content: 'サーバー' });
    localList = [local('x', { content: '表示時点の PC' })];
    return server;
  }

  it('with "PC": the shown version is written, then the newer edit is asked again', async () => {
    const server = shown();
    const first = await runMigration(depsFor(server));
    if (first.status !== 'needsDecision') throw new Error('expected a difference');
    editLocal('x', { content: '表示の後の PC' });
    const after = await applyDecisions(depsFor(server), first.diffs, { x: 'pc' });
    expect(after.status).toBe('needsDecision');
    if (after.status !== 'needsDecision') return;
    expect(after.diffs[0]?.local.content).toBe('表示の後の PC');
    expect(record.phase).not.toBe('done');
    expect(completed).toBe(0);
    const done = await applyDecisions(depsFor(server), after.diffs, { x: 'pc' });
    expect(done.status).toBe('done');
    expect(server.notes.get('x')?.content).toBe('表示の後の PC');
  });

  it('with "server": the choice covers only the shown version, so the edit is asked again', async () => {
    const server = shown();
    const first = await runMigration(depsFor(server));
    if (first.status !== 'needsDecision') throw new Error('expected a difference');
    editLocal('x', { content: '表示の後の PC' });
    const after = await applyDecisions(depsFor(server), first.diffs, { x: 'server' });
    expect(after.status).toBe('needsDecision');
    if (after.status !== 'needsDecision') return;
    expect(after.diffs.map((d) => d.id)).toEqual(['x']);
    expect(server.notes.get('x')?.content).toBe('サーバー');
    // Without a further edit, the same "server" choice stays settled across a resume.
    const done = await applyDecisions(depsFor(server), after.diffs, { x: 'server' });
    expect(done.status).toBe('done');
    expect((await runMigration(depsFor(server))).status).toBe('done');
  });
});

describe('a note whose id another workspace holds', () => {
  it('is reported as blocked, its links are not sent, and the migration is not done', async () => {
    const server = createFakeNoteServer();
    server.foreign.add('held');
    localList = [local('held', { linkedTaskIds: [7] }), local('free')];
    const result = await runMigration(depsFor(server));
    expect(result.status).toBe('needsDecision');
    if (result.status !== 'needsDecision') return;
    expect(result.blocked).toEqual([{ id: 'held', title: 't-held' }]);
    expect(result.diffs).toEqual([]);
    expect(server.notes.has('free')).toBe(true);
    expect(server.notes.has('held')).toBe(false);
    expect(server.links.size).toBe(0);
    expect(record.rejectedLinks).toEqual([]);
    expect(record.phase).toBe('resolving');
    expect(completed).toBe(0);
    // Running again does not turn it into "done" either.
    const again = await runMigration(depsFor(server));
    expect(again.status).toBe('needsDecision');
    expect(record.phase).not.toBe('done');
  });
});

describe('"keep both" and an existing {id}-pc', () => {
  function differing() {
    const server = createFakeNoteServer();
    server.put('k', { title: 't-k', content: 'サーバー' });
    localList = [local('k', { content: 'PC' })];
    return server;
  }

  it('settles when the existing copy has exactly the PC version', async () => {
    const server = differing();
    server.put('k-pc', { title: 't-k', content: 'PC' });
    const first = await runMigration(depsFor(server));
    // The matching copy already settles it; nothing is asked.
    expect(first.status).toBe('done');
  });

  it('stays unresolved, with "both" unavailable, when the copy has other content', async () => {
    const server = differing();
    const first = await runMigration(depsFor(server));
    if (first.status !== 'needsDecision') throw new Error('expected a difference');
    server.put('k-pc', { title: '別のノート', content: '別の内容' });
    const after = await applyDecisions(depsFor(server), first.diffs, { k: 'both' });
    expect(after.status).toBe('needsDecision');
    if (after.status !== 'needsDecision') return;
    expect(after.diffs.map((d) => [d.id, d.copyUnavailable])).toEqual([['k', true]]);
    expect(server.notes.get('k-pc')?.content).toBe('別の内容');
    expect(completed).toBe(0);
    const done = await applyDecisions(depsFor(server), after.diffs, { k: 'pc' });
    expect(done.status).toBe('done');
    expect(server.notes.get('k')?.content).toBe('PC');
  });

  it('stays unresolved when another workspace holds the copy id', async () => {
    const server = differing();
    server.foreign.add('k-pc');
    const first = await runMigration(depsFor(server));
    if (first.status !== 'needsDecision') throw new Error('expected a difference');
    const after = await applyDecisions(depsFor(server), first.diffs, { k: 'both' });
    expect(after.status).toBe('needsDecision');
    if (after.status !== 'needsDecision') return;
    expect(after.diffs[0]?.copyUnavailable).toBe(true);
    expect(record.blockedCopies).toEqual(['k']);
  });

  it('recognises a copy whose response was lost on resume, without asking again', async () => {
    const server = differing();
    const first = await runMigration(depsFor(server));
    if (first.status !== 'needsDecision') throw new Error('expected a difference');
    server.failNext('importNotes', 'after');
    await expect(applyDecisions(depsFor(server), first.diffs, { k: 'both' })).rejects.toThrow();
    expect(server.notes.get('k-pc')?.content).toBe('PC');
    const resumed = await runMigration(depsFor(server));
    expect(resumed.status).toBe('done');
    expect(server.notes.get('k')?.content).toBe('サーバー');
    expect(server.creates).toBe(1);
  });
});
