/**
 * placement-initial.test
 *
 * The one-time initial placement of the notes that existed before stage 1
 * (design §2.2「既存ノートの初期値」), over the in-memory database: same
 * effective theme for every linked task → that theme, anything else 未分類,
 * followsTask false, updatedAt kept, and a second run changes nothing.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { createStage1Db, type Stage1Db } from '../../../tests/helpers/notes-stage1-db';
import { runPlacementInitialMigration } from './placement-initial';

type Row = Record<string, unknown>;
let db: Stage1Db;
const p = () => db.prisma as never;
const note = (id: string) => db.find('note', { id }) as Row;

describe('initial placement of existing notes (§2.2)', () => {
  beforeEach(() => {
    db = createStage1Db({
      theme: [{ id: 1 }, { id: 2 }, { id: 9, workspaceId: 2 }],
      task: [
        { id: 10, themeId: 1 },
        { id: 11, parentId: 10 }, // effective theme 1 through its parent
        { id: 12, themeId: 2 },
        { id: 90, themeId: 9, workspaceId: 2 },
      ],
      note: [
        { id: 'same', updatedAt: new Date('2026-10-01T00:00:00Z') },
        { id: 'mixed' },
        { id: 'unlinked' },
        { id: 'ws2', workspaceId: 2 },
        { id: 'cross' }, // linked to a task of another workspace
      ],
      noteTaskLink: [
        { noteId: 'same', taskId: 10 },
        { noteId: 'same', taskId: 11 },
        { noteId: 'mixed', taskId: 10 },
        { noteId: 'mixed', taskId: 12 },
        { noteId: 'ws2', taskId: 90, workspaceId: 2 },
        { noteId: 'cross', taskId: 90 },
      ],
    });
  });

  it('places a note whose tasks share one effective theme, leaves the rest 未分類', async () => {
    const result = await runPlacementInitialMigration(p());
    expect(result).toEqual({ skipped: false, placed: 2, unclassified: 3 });
    expect(note('same')).toMatchObject({ themeId: 1, followsTask: false });
    expect(note('ws2')).toMatchObject({ themeId: 9 });
    for (const id of ['mixed', 'unlinked', 'cross']) expect(note(id).themeId).toBeNull();
  });

  it('keeps updatedAt, so the list order does not change', async () => {
    await runPlacementInitialMigration(p());
    expect(note('same').updatedAt).toEqual(new Date('2026-10-01T00:00:00Z'));
  });

  it('runs once: a re-run after a person moved a note to 未分類 changes nothing', async () => {
    await runPlacementInitialMigration(p());
    note('same').themeId = null; // the person's move
    expect(await runPlacementInitialMigration(p())).toMatchObject({ skipped: true });
    expect(note('same').themeId).toBeNull();
  });
});
