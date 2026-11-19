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
 *
 * Also the three-party order of review G2 fix1 must-fix 1 (a create of the
 * renamed folder's old name lands while the rename is between its write and
 * its re-check), and the transaction those writes now run in.
 */
import { describe, it, expect } from 'bun:test';
import { createStage1Db } from '../../../tests/helpers/notes-stage1-db';
import { createNoteFolder, updateNoteFolder } from './note-folders';

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

describe('a rename that loses after it wrote', () => {
  // Review G2 fix1 must-fix 1: A renames 雑記 → 旅行 (and moves it) while 旅行
  // is being taken; right after A's write, C creates a folder named 雑記. A
  // must answer 409 having changed nothing — no second 雑記, no new sortOrder.
  it('leaves no duplicate of the old name and no partial sortOrder', async () => {
    const db = createStage1Db({
      noteFolder: [
        { id: 5, name: '雑記', sortOrder: 1 },
        { id: 7, name: '旅行', sortOrder: 2 },
      ],
    });
    const p = db.prisma as never;
    const folders = db.prisma.noteFolder as Delegate & {
      updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
    };
    const realFind = folders.findFirst;
    const realUpdate = folders.updateMany;
    let staleOnce = true;
    folders.findFirst = async (args) => {
      // A's "is 旅行 free?" check ran before the concurrent write of 旅行 landed.
      if (staleOnce && (args.where as { name?: string }).name === '旅行') {
        staleOnce = false;
        return null;
      }
      return realFind(args);
    };
    let third: Promise<unknown> | undefined;
    folders.updateMany = async (args) => {
      const out = await realUpdate(args);
      if (!third && (args.data as { name?: string }).name === '旅行') {
        third = createNoteFolder(p, { name: '雑記' }).catch((e: unknown) => e);
        // Let C run as far as it can while A sits between its write and its check.
        await Promise.race([third, new Promise((r) => setTimeout(r, 0))]);
      }
      return out;
    };

    await expect(updateNoteFolder(p, 5, { name: '旅行', sortOrder: 9 })).rejects.toMatchObject({
      code: 'folder_name_taken',
      status: 409,
    });
    const outcomeOfC = await third;
    const rows = db
      .rows('noteFolder')
      .map((f) => ({ id: f.id, name: f.name, sortOrder: f.sortOrder }));
    const names = rows.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    expect(rows.find((r) => r.id === 5)).toEqual({ id: 5, name: '雑記', sortOrder: 1 });
    // 雑記 was never free outside A's transaction, so C is refused as well.
    expect(outcomeOfC).toMatchObject({ code: 'folder_name_taken', status: 409 });
    expect(rows).toHaveLength(2);
  });
});

describe('the folder write transaction', () => {
  it('asks for Serializable and keeps a stale-check create from leaving a duplicate', async () => {
    const db = createStage1Db({ noteFolder: [{ id: 5, name: '雑記' }] });
    const p = db.prisma as never;
    const seen: unknown[] = [];
    const realTx = db.prisma.$transaction as (fn: unknown, opts?: unknown) => Promise<unknown>;
    db.prisma.$transaction = (fn: unknown, opts?: unknown) => {
      seen.push(opts);
      return realTx(fn, opts);
    };
    const folders = db.prisma.noteFolder as Delegate;
    const real = folders.findFirst;
    let staleOnce = true;
    folders.findFirst = async (args) => {
      if (staleOnce && (args.where as { name?: string }).name === '雑記') {
        staleOnce = false;
        return null;
      }
      return real(args);
    };
    await expect(createNoteFolder(p, { name: '雑記' })).rejects.toMatchObject({ status: 409 });
    expect(db.rows('noteFolder').map((f) => f.id)).toEqual([5]);
    expect(seen).toEqual([{ isolationLevel: 'Serializable' }]);
  });

  it('answers 409 and changes nothing when the database aborts on a write conflict', async () => {
    const db = createStage1Db({ noteFolder: [{ id: 5, name: '雑記', sortOrder: 1 }] });
    const p = db.prisma as never;
    const folders = db.prisma.noteFolder as Delegate;
    const real = folders.findFirst;
    folders.findFirst = async (args) => {
      if ((args.select as { createdAt?: boolean } | undefined)?.createdAt) {
        throw Object.assign(new Error('could not serialize access'), { code: 'P2034' });
      }
      return real(args);
    };
    await expect(updateNoteFolder(p, 5, { name: '日記', sortOrder: 4 })).rejects.toMatchObject({
      code: 'folder_write_conflict',
      status: 409,
    });
    expect(db.find('noteFolder', { id: 5 })).toMatchObject({ name: '雑記', sortOrder: 1 });
  });
});
