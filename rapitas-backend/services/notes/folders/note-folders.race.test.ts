/**
 * note-folders.race.test
 *
 * Two renames racing to the same unused folder name (design §2.2「名前の重複」,
 * review G2 should-fix). The late rename passed the "is the name taken?"
 * check before the early one was written; after its own write it must see
 * the duplicate, put its old name back and answer 409, so the workspace never
 * ends with two folders of one name.
 *
 * The race is made deterministic by letting the late rename's check see the
 * folders as they were before the early rename.
 */
import { describe, it, expect } from 'bun:test';
import { createStage1Db } from '../../../tests/helpers/notes-stage1-db';
import { updateNoteFolder } from './note-folders';

type Delegate = { findFirst: (args: Record<string, unknown>) => Promise<unknown> };

describe('concurrent renames to one name', () => {
  it('backs the late rename out with 409 and keeps the names unique', async () => {
    const db = createStage1Db({
      noteFolder: [
        { id: 5, name: '雑記' },
        { id: 7, name: '買い物' },
      ],
    });
    const p = db.prisma as never;
    const folders = db.prisma.noteFolder as Delegate;
    const real = folders.findFirst;
    let staleOnce = false;
    folders.findFirst = async (args) => {
      if (staleOnce && (args.where as { name?: string }).name === '旅行') {
        staleOnce = false;
        return null;
      }
      return real(args);
    };

    // The higher id renames first, so "the lower id wins" would keep both.
    await updateNoteFolder(p, 7, { name: '旅行' });
    staleOnce = true;
    await expect(updateNoteFolder(p, 5, { name: '旅行' })).rejects.toMatchObject({
      code: 'folder_name_taken',
      status: 409,
    });
    const names = db
      .rows('noteFolder')
      .map((f) => f.name)
      .sort();
    expect(names).toEqual(['旅行', '雑記']);
  });
});
