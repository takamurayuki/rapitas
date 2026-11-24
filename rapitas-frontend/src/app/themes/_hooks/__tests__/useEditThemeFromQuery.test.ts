/**
 * useEditThemeFromQuery.test
 *
 * 2026-11-24: auto-run notifications linked to `/themes/<id>`, a page that does
 * not exist, so every click was a 404. They now link to `/themes?edit=<id>`,
 * and the theme list has to open that theme — in its own category tab, since
 * the list shows one category at a time.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category, Theme } from '@/types';
import { useEditThemeFromQuery } from '../useEditThemeFromQuery';

const THEMES = [
  { id: 1, name: 'rapitas', categoryId: 1 },
  { id: 18, name: 'trendline', categoryId: 2 },
] as Theme[];
const CATEGORIES = [{ id: 1 }, { id: 2 }] as Category[];

function setQuery(search: string) {
  window.history.replaceState(null, '', `/themes${search}`);
}

describe('useEditThemeFromQuery', () => {
  afterEach(() => setQuery(''));

  it('opens the theme named by ?edit in its own category', () => {
    setQuery('?edit=18');
    const startEdit = vi.fn();
    const setSelectedCategoryId = vi.fn();
    renderHook(() =>
      useEditThemeFromQuery({
        items: THEMES,
        categories: CATEGORIES,
        startEdit,
        setSelectedCategoryId,
      }),
    );
    expect(setSelectedCategoryId).toHaveBeenCalledWith(2);
    expect(startEdit).toHaveBeenCalledWith(THEMES[1]);
  });

  it('waits until both themes and categories have loaded', () => {
    setQuery('?edit=18');
    const startEdit = vi.fn();
    const setSelectedCategoryId = vi.fn();
    const { rerender } = renderHook(
      ({ items, categories }) =>
        useEditThemeFromQuery({ items, categories, startEdit, setSelectedCategoryId }),
      { initialProps: { items: [] as Theme[], categories: [] as Category[] } },
    );
    expect(startEdit).not.toHaveBeenCalled();

    rerender({ items: THEMES, categories: CATEGORIES });
    expect(startEdit).toHaveBeenCalledTimes(1);

    // A later reload of the list must not reopen it after the user closed it.
    rerender({ items: [...THEMES], categories: CATEGORIES });
    expect(startEdit).toHaveBeenCalledTimes(1);
  });

  it.each(['', '?edit=999', '?edit=abc'])('does nothing for %j', (search) => {
    setQuery(search);
    const startEdit = vi.fn();
    const setSelectedCategoryId = vi.fn();
    renderHook(() =>
      useEditThemeFromQuery({
        items: THEMES,
        categories: CATEGORIES,
        startEdit,
        setSelectedCategoryId,
      }),
    );
    expect(startEdit).not.toHaveBeenCalled();
    expect(setSelectedCategoryId).not.toHaveBeenCalled();
  });
});
