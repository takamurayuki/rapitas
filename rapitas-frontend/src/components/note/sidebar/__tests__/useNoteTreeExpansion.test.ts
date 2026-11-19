/**
 * useNoteTreeExpansion.test
 *
 * The /notes sidebar tree's open/closed state, as NoteSidebar had it before
 * the split: the open note's path opens (from link meta, else from the
 * title), a search opens everything, and each level toggles on its own.
 */
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Note } from '@/stores/note-store';
import { buildNoteTree } from '../../note-tree-utils';
import { useNoteTreeExpansion } from '../useNoteTreeExpansion';

const note = (id: string, over: Partial<Note> = {}): Note => ({
  id,
  title: `t-${id}`,
  content: '',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
  isPinned: false,
  tags: [],
  ...over,
});

const notes = [
  note('a', {
    linkedTaskIds: [7],
    linkedTaskMeta: { 7: { taskTitle: 'T7', themeName: 'Th', categoryName: 'C' } },
  }),
  note('b', { linkedTaskIds: [8], linkedTaskMeta: { 8: { taskTitle: 'T8', themeName: 'Solo' } } }),
];

function render(currentNoteId: string | null, searchQuery = '') {
  const tree = buildNoteTree(notes);
  return renderHook((props: { currentNoteId: string | null; searchQuery: string }) =>
    useNoteTreeExpansion({ tree, notes, ...props }),
    { initialProps: { currentNoteId, searchQuery } },
  );
}

describe('useNoteTreeExpansion', () => {
  it('opens the category > theme > task path of the open note from its link meta', () => {
    const { result } = render('a');
    expect([...result.current.expandedCategories]).toEqual(['C']);
    expect([...result.current.expandedThemes]).toEqual(['C|||Th']);
    expect([...result.current.expandedTasks]).toEqual(['C|||Th|||7']);
  });

  it('opens a theme-only path for a note linked without a category', () => {
    const { result } = render('b');
    expect(result.current.expandedCategories.size).toBe(0);
    expect([...result.current.expandedThemes]).toEqual(['theme:Solo']);
    expect([...result.current.expandedTasks]).toEqual(['theme:Solo|||8']);
  });

  it('opens every group while a search is active', () => {
    const { result } = render(null, 't-');
    expect([...result.current.expandedCategories]).toEqual(['C']);
    expect([...result.current.expandedThemes].sort()).toEqual(['C|||Th', 'theme:Solo']);
    expect([...result.current.expandedTasks].sort()).toEqual(['C|||Th|||7', 'theme:Solo|||8']);
  });

  it('toggles each level independently', () => {
    const { result } = render(null);
    act(() => result.current.toggleCategory('C'));
    act(() => result.current.toggleTask('C|||Th|||7'));
    expect([...result.current.expandedCategories]).toEqual(['C']);
    expect(result.current.expandedThemes.size).toBe(0);
    act(() => result.current.toggleCategory('C'));
    expect(result.current.expandedCategories.size).toBe(0);
    expect([...result.current.expandedTasks]).toEqual(['C|||Th|||7']);
  });
});
