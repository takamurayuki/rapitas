/**
 * placement-consistency-job.test
 *
 * The hourly placement check (design §2.2 contract 6) over the in-memory
 * database: moving following notes whose task's theme changed by another
 * path, normalising notes whose source task is gone (including a dangling id
 * from a database without the foreign key), never following a task of
 * another workspace, processing each note inside its own workspace, and
 * agreeing with the theme delete (nothing left to correct afterwards).
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import type { Stage1Db } from '../../../tests/helpers/notes-stage1-db';
import { seedStage1 } from '../../../tests/helpers/notes-stage1-seed';
import { runPlacementConsistencyCheck } from './placement-consistency-job';
import { deleteThemeWithNotes } from './theme-delete';

type Row = Record<string, unknown>;
let db: Stage1Db;
const p = () => db.prisma as never;
const note = (id: string) => db.find('note', { id }) as Row;
const task = (id: number) => db.find('task', { id }) as Row;

describe('the consistency check (contract 6)', () => {
  beforeEach(() => {
    db = seedStage1();
  });

  it('moves a following note whose task’s theme changed by another path', async () => {
    task(101).themeId = 11; // written without the task service
    expect(await runPlacementConsistencyCheck(p())).toMatchObject({ moved: 1 });
    expect(note('deliverable-task-101').themeId).toBe(11);
    // A second run has nothing to do.
    expect(await runPlacementConsistencyCheck(p())).toEqual({
      moved: 0,
      normalized: 0,
      skippedForeign: 0,
    });
  });

  it('normalises a following note whose source task is gone, without moving it', async () => {
    await db.prisma.task.deleteMany({ where: { id: 101 } }); // FK SetNull on sourceTaskId
    expect(await runPlacementConsistencyCheck(p())).toMatchObject({ normalized: 1 });
    expect(note('deliverable-task-101')).toMatchObject({
      themeId: 10,
      followsTask: false,
      sourceTaskId: null,
    });
  });

  it('normalises a dangling sourceTaskId left by a database without the foreign key', async () => {
    note('deliverable-task-101').sourceTaskId = 4242;
    await runPlacementConsistencyCheck(p());
    expect(note('deliverable-task-101')).toMatchObject({
      followsTask: false,
      sourceTaskId: null,
      themeId: 10,
    });
  });

  it('never follows a source task of another workspace', async () => {
    note('deliverable-task-101').sourceTaskId = 200;
    expect(await runPlacementConsistencyCheck(p())).toMatchObject({ skippedForeign: 1, moved: 0 });
    expect(note('deliverable-task-101')).toMatchObject({ themeId: 10, sourceTaskId: 200 });
  });

  it('processes a workspace-2 note inside workspace 2', async () => {
    db.rows('note').push({
      ...note('other-ws'),
      id: 'ws2-deliverable',
      source: 'deliverable',
      sourceTaskId: 200,
      followsTask: true,
      themeId: null,
    });
    expect(await runPlacementConsistencyCheck(p())).toMatchObject({ moved: 1 });
    expect(note('ws2-deliverable').themeId).toBe(20);
  });
});

describe('a dangling sourceTaskId on a note that no longer follows (Must-fix 8)', () => {
  beforeEach(() => {
    db = seedStage1();
  });

  it('is cleared — placement and followsTask unchanged — when no task has the id', async () => {
    // A person moved the deliverable (follow stopped), then its task was deleted
    // in a self-healed desktop DB whose sourceTaskId column has no foreign key.
    Object.assign(note('deliverable-task-101'), {
      followsTask: false,
      categoryId: 1,
      themeId: null,
      sourceTaskId: 4242,
    });
    expect(await runPlacementConsistencyCheck(p())).toMatchObject({ normalized: 1, moved: 0 });
    expect(note('deliverable-task-101')).toMatchObject({
      sourceTaskId: null,
      followsTask: false,
      categoryId: 1,
      themeId: null,
    });
    // A second run has nothing left to do.
    expect(await runPlacementConsistencyCheck(p())).toMatchObject({ normalized: 0 });
  });

  it('is left alone while the task exists, here or in another workspace', async () => {
    note('deliverable-task-101').followsTask = false;
    db.rows('note').push({
      ...note('deliverable-task-101'),
      id: 'points-at-ws2',
      sourceTaskId: 200,
    });
    expect(await runPlacementConsistencyCheck(p())).toMatchObject({ normalized: 0 });
    expect(note('deliverable-task-101').sourceTaskId).toBe(101);
    expect(note('points-at-ws2').sourceTaskId).toBe(200);
  });

  it('is cleared inside the note’s own workspace', async () => {
    db.rows('note').push({
      ...note('other-ws'),
      id: 'ws2-moved',
      source: 'deliverable',
      sourceTaskId: 4243,
      followsTask: false,
    });
    expect(await runPlacementConsistencyCheck(p())).toMatchObject({ normalized: 1 });
    expect(note('ws2-moved')).toMatchObject({ sourceTaskId: null, workspaceId: 2, themeId: 20 });
  });
});

describe('the check after a theme delete', () => {
  beforeEach(() => {
    db = seedStage1();
  });

  it('finds nothing to correct once the delete has re-placed the notes', async () => {
    task(101).themeId = 10;
    task(100).themeId = 11;
    await deleteThemeWithNotes(p(), 10);
    expect(await runPlacementConsistencyCheck(p())).toEqual({
      moved: 0,
      normalized: 0,
      skippedForeign: 0,
    });
  });
});
