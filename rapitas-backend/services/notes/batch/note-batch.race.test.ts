/**
 * note-batch.race.test
 *
 * Two `POST /notes/batch` requests for the same fixed id racing to create it
 * (design §8.3 contract 3, review G2 must-fix 7). The late one passed the
 * "does the id exist?" check before the early one committed, so its create
 * hits the unique constraint. It must then behave like the normal existing-id
 * path: add the links it carries that the note lacks and report them in
 * `linksAdded`, as `skipped`.
 *
 * The race is made deterministic by letting the late request's existence
 * check see the database as it was before the early request committed.
 */
import { describe, it, expect } from 'bun:test';
import { seedStage1 } from '../../../tests/helpers/notes-stage1-seed';
import { createNotesBatch, type BatchItem } from './note-batch';

type Delegate = { findFirst: (args: Record<string, unknown>) => Promise<unknown> };

describe('a concurrent resend of the same fixed id', () => {
  it('adds the late request’s missing links after the unique violation', async () => {
    const db = seedStage1();
    const p = db.prisma as never;
    const item = (taskIds: number[]): BatchItem => ({
      id: 'roadmap-11-1',
      title: '締め',
      content: '',
      source: 'roadmap',
      taskIds,
    });

    // The late request's existence check ran before the early one committed.
    const notes = db.prisma.note as Delegate;
    const realFindFirst = notes.findFirst;
    let staleOnce = false;
    notes.findFirst = async (args) => {
      const where = args.where as { id?: string };
      if (staleOnce && where.id === 'roadmap-11-1') {
        staleOnce = false;
        return null;
      }
      return realFindFirst(args);
    };

    const [early] = await createNotesBatch(p, [item([102])]);
    expect(early).toEqual({ id: 'roadmap-11-1', status: 'created', linksAdded: 1 });

    staleOnce = true;
    const [late] = await createNotesBatch(p, [item([102, 100])]);
    expect(late).toEqual({ id: 'roadmap-11-1', status: 'skipped', linksAdded: 1 });
    const links = db
      .rows('noteTaskLink')
      .filter((l) => l.noteId === 'roadmap-11-1')
      .map((l) => l.taskId)
      .sort();
    expect(links).toEqual([100, 102]);
    // The early request's note is kept as it was.
    expect(db.find('note', { id: 'roadmap-11-1' })).toMatchObject({ title: '締め', themeId: 11 });
  });
});
