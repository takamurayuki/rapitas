/**
 * placement-rules.test
 *
 * The pure rules of notes stage 1: describePlacement's precedence and its
 * treatment of a column naming no in-scope row, the column form of a
 * placement, reserved ids and deliverable sources.
 */
import { describe, it, expect } from 'bun:test';
import { describePlacement, emptyLookup } from './describe-placement';
import { columnsFor, isDeliverableSource, isReservedNoteId } from './placement-types';

const lookup = () => {
  const l = emptyLookup();
  l.themes.set(1, { id: 1, name: 'T', categoryId: 2 });
  l.themes.set(3, { id: 3, name: 'U', categoryId: 99 }); // category not in scope
  l.categories.set(2, { id: 2, name: 'C' });
  l.folders.set(4, { id: 4, name: 'F' });
  return l;
};

describe('describePlacement', () => {
  it('reads theme, then category, then folder', () => {
    expect(describePlacement({ themeId: 1, categoryId: 2, folderId: 4 }, lookup()).kind).toBe(
      'theme',
    );
    expect(describePlacement({ categoryId: 2, folderId: 4 }, lookup())).toEqual({
      kind: 'category',
      categoryId: 2,
      categoryName: 'C',
    });
    expect(describePlacement({ folderId: 4 }, lookup())).toEqual({
      kind: 'folder',
      folderId: 4,
      folderName: 'F',
    });
  });

  it('skips a column naming no row of the workspace', () => {
    expect(describePlacement({ themeId: 9, folderId: 4 }, lookup()).kind).toBe('folder');
    expect(describePlacement({ themeId: 9 }, lookup())).toEqual({ kind: 'none' });
    expect(describePlacement({ themeId: 3 }, lookup())).toMatchObject({
      kind: 'theme',
      categoryId: null,
    });
  });
});

describe('placement types', () => {
  it('sets exactly one column', () => {
    expect(columnsFor('folder', 4)).toEqual({ themeId: null, categoryId: null, folderId: 4 });
    expect(columnsFor('none', 4)).toEqual({ themeId: null, categoryId: null, folderId: null });
  });

  it.each(['deliverable-task-1', 'research-task-1', 'learning-task-1', 'roadmap-1-2'])(
    'reserves %s',
    (id) => {
      expect(isReservedNoteId(id)).toBe(true);
    },
  );

  it('does not reserve a browser id', () => {
    expect(isReservedNoteId('1795000000000')).toBe(false);
  });

  it('calls every source but manual / chat a deliverable', () => {
    expect(['manual', 'chat'].map(isDeliverableSource)).toEqual([false, false]);
    expect(
      ['deliverable', 'research', 'learning', 'material', 'roadmap'].every(isDeliverableSource),
    ).toBe(true);
  });
});
