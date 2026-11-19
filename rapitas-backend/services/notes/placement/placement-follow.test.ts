/**
 * placement-follow.test
 *
 * The placement writers of design §2.2 besides the hourly check, over the
 * in-memory database: following a task's theme (contract 5 — only to a
 * non-NULL effective theme, never a note a person moved), the effective
 * theme through parents, and a theme delete decided by
 * placementAfterThemeDelete in one transaction.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import type { Stage1Db } from '../../../tests/helpers/notes-stage1-db';
import { seedStage1 } from '../../../tests/helpers/notes-stage1-seed';
import { runInWorkspace } from '../../tenancy/workspace-context';
import { followIfEffectiveThemeChanged, followTaskThemeChange } from './note-follow';
import { deleteThemeWithNotes, placementAfterThemeDelete, planThemeDelete } from './theme-delete';
import { resolveEffectiveTheme } from './effective-theme';

type Row = Record<string, unknown>;
let db: Stage1Db;
const p = () => db.prisma as never;
const note = (id: string) => db.find('note', { id }) as Row;
const task = (id: number) => db.find('task', { id }) as Row;

describe('following the source task (contract 5)', () => {
  beforeEach(() => {
    db = seedStage1();
  });

  it('moves a following deliverable when the parent’s theme changes to a value', async () => {
    task(100).themeId = 11;
    expect(await followTaskThemeChange(p(), 100)).toBe(1);
    expect(note('deliverable-task-101')).toMatchObject({ themeId: 11, followsTask: true });
  });

  it('does not move when the effective theme becomes NULL', async () => {
    task(100).themeId = null;
    expect(await followTaskThemeChange(p(), 100)).toBe(0);
    expect(note('deliverable-task-101').themeId).toBe(10);
  });

  it('does not move a deliverable a person has moved (followsTask false)', async () => {
    note('deliverable-task-101').followsTask = false;
    task(100).themeId = 11;
    expect(await followTaskThemeChange(p(), 100)).toBe(0);
  });

  it('resolves the effective theme through parents, bounded against a cycle', async () => {
    expect(await resolveEffectiveTheme(p(), 101)).toBe(10);
    task(100).themeId = null;
    task(100).parentId = 101; // 100 ↔ 101
    expect(await resolveEffectiveTheme(p(), 101)).toBeNull();
  });
});

describe('the immediate follow on a task update (Must-fix 5)', () => {
  beforeEach(() => {
    db = seedStage1();
  });

  it('moves nothing when the same themeId is sent again (effective theme unchanged)', async () => {
    // A placement gap left for the hourly check: the note sits on theme 11.
    note('deliverable-task-101').themeId = 11;
    const before = await resolveEffectiveTheme(p(), 100); // 10
    task(100).themeId = 10; // the update re-sends the same theme
    expect(await followIfEffectiveThemeChanged(p(), 100, before)).toBe(0);
    expect(note('deliverable-task-101').themeId).toBe(11);
  });

  it('moves nothing when an own theme equal to the inherited one is set', async () => {
    note('deliverable-task-101').themeId = 11;
    const before = await resolveEffectiveTheme(p(), 101); // 10, inherited from 100
    task(101).themeId = 10;
    expect(await followIfEffectiveThemeChanged(p(), 101, before)).toBe(0);
    expect(note('deliverable-task-101').themeId).toBe(11);
  });

  it('follows when the effective theme changes to a non-NULL value', async () => {
    const before = await resolveEffectiveTheme(p(), 100);
    task(100).themeId = 11;
    expect(await followIfEffectiveThemeChanged(p(), 100, before)).toBe(1);
    expect(note('deliverable-task-101').themeId).toBe(11);
  });

  it('does not follow when the effective theme becomes NULL', async () => {
    const before = await resolveEffectiveTheme(p(), 100);
    task(100).themeId = null;
    expect(await followIfEffectiveThemeChanged(p(), 100, before)).toBe(0);
    expect(note('deliverable-task-101').themeId).toBe(10);
  });
});

describe('deleting a theme (placementAfterThemeDelete)', () => {
  beforeEach(() => {
    db = seedStage1();
  });

  it('is one rule for every note (pure)', () => {
    const following = { id: 'a', followsTask: true, sourceTaskId: 1 };
    expect(placementAfterThemeDelete(following, { categoryId: 3 }, 7)).toEqual({
      themeId: 7,
      categoryId: null,
      folderId: null,
    });
    expect(placementAfterThemeDelete(following, { categoryId: 3 }, null)).toEqual({
      themeId: null,
      categoryId: 3,
      folderId: null,
    });
    expect(
      placementAfterThemeDelete({ ...following, followsTask: false }, { categoryId: null }, 7),
    ).toEqual({
      themeId: null,
      categoryId: null,
      folderId: null,
    });
  });

  it('moves a following subtask deliverable to the parent’s other theme', async () => {
    // 101's own theme is the one being deleted; its parent 100 has theme 11.
    task(101).themeId = 10;
    task(100).themeId = 11;
    const plan = await planThemeDelete(p(), 10);
    expect(plan?.moves).toEqual([
      { noteId: 'n-theme', to: { themeId: null, categoryId: 1, folderId: null } },
      { noteId: 'deliverable-task-101', to: { themeId: 11, categoryId: null, folderId: null } },
    ]);
    await deleteThemeWithNotes(p(), 10);
    expect(note('n-theme')).toMatchObject({ categoryId: 1, themeId: null });
    expect(note('deliverable-task-101')).toMatchObject({ themeId: 11, followsTask: true });
    expect(db.find('theme', { id: 10 })).toBeUndefined();
  });

  it('keeps the notes and the theme when the delete fails inside the transaction', async () => {
    const original = db.prisma.theme as Row;
    db.prisma.theme = { ...original, deleteMany: async () => Promise.reject(new Error('locked')) };
    await expect(deleteThemeWithNotes(p(), 10)).rejects.toThrow('locked');
    db.prisma.theme = original;
    expect(note('n-theme')).toMatchObject({ themeId: 10, categoryId: null });
  });

  it('does not reach into another workspace through the theme of workspace 2', async () => {
    await runInWorkspace(2, () => deleteThemeWithNotes(p(), 20));
    expect(note('other-ws')).toMatchObject({ categoryId: 2, themeId: null });
    expect(note('n-theme').themeId).toBe(10);
  });
});
