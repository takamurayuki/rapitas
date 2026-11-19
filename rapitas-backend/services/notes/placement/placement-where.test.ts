/**
 * placement-where.test
 *
 * The list filter and describePlacement come from ONE rule source (design
 * §2.2 contract 3): `placementWhere` is generated from the same precedence
 * table describePlacement walks. Checked exhaustively over every combination
 * of the three columns — empty, an in-scope row, another workspace's row, a
 * dangling id — for every target kind, both as a raw `where` and through
 * `GET /notes`' service (queryNotes).
 */
import { describe, it, expect } from 'bun:test';
import { createStage1Db } from '../../../tests/helpers/notes-stage1-db';
import {
  describePlacement,
  loadPlacementLookup,
  placementWhere,
  type PlacementTarget,
} from './describe-placement';
import { queryNotes } from '../read/note-query';

const THEMES = [null, 10, 20, 999];
const CATEGORIES = [null, 1, 2, 998];
const FOLDERS = [null, 5, 6, 997];

function seed() {
  const note: Record<string, unknown>[] = [];
  for (const themeId of THEMES)
    for (const categoryId of CATEGORIES)
      for (const folderId of FOLDERS)
        note.push({ id: `n-${themeId}-${categoryId}-${folderId}`, themeId, categoryId, folderId });
  return createStage1Db({
    category: [{ id: 1 }, { id: 2, workspaceId: 2 }],
    theme: [
      { id: 10, categoryId: 1 },
      { id: 20, workspaceId: 2 },
    ],
    noteFolder: [{ id: 5 }, { id: 6, workspaceId: 2 }],
    note,
  });
}

const TARGETS: PlacementTarget[] = [
  { kind: 'theme', id: 10 },
  { kind: 'category', id: 1 },
  { kind: 'folder', id: 5 },
  { kind: 'none' },
];

const sameTarget = (placement: ReturnType<typeof describePlacement>, t: PlacementTarget) => {
  if (placement.kind !== t.kind) return false;
  if (t.kind === 'theme') return placement.themeId === t.id;
  if (t.kind === 'category') return placement.categoryId === t.id;
  if (t.kind === 'folder') return placement.folderId === t.id;
  return true;
};

describe('placementWhere and describePlacement agree (Must-fix 6)', () => {
  it.each(TARGETS.map((t) => [JSON.stringify(t), t] as const))(
    'selects exactly the notes describePlacement puts at %s',
    async (_label, target) => {
      const db = seed();
      const p = db.prisma as never;
      const lookup = await loadPlacementLookup(p, {
        themeIds: 'all',
        categoryIds: 'all',
        folderIds: 'all',
      });
      const expected = db
        .rows('note')
        .filter((n) => sameTarget(describePlacement(n as never, lookup), target))
        .map((n) => n.id as string)
        .sort();
      expect(expected.length).toBeGreaterThan(0);

      const raw = (await (
        db.prisma.note as { findMany: (a: unknown) => Promise<{ id: string }[]> }
      ).findMany({ where: { AND: placementWhere(target, lookup) } })) as { id: string }[];
      expect(raw.map((r) => r.id).sort()).toEqual(expected);

      const key = {
        theme: 'themeId',
        category: 'categoryId',
        folder: 'folderId',
        none: 'folderId',
      }[target.kind];
      const page = await queryNotes(p, { [key]: target.kind === 'none' ? 'none' : target.id });
      expect(page.notes.map((n) => n.id).sort()).toEqual(expected);
      for (const n of page.notes) expect(sameTarget(n.placement, target)).toBe(true);
    },
  );
});
