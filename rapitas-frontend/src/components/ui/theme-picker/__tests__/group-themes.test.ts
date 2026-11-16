/**
 * group-themes.test
 *
 * Grouping that turns a flat theme list into the category → theme tree the
 * picker renders.
 */
import { describe, it, expect } from 'vitest';
import type { Category, Theme } from '@/types';
import { groupThemesByCategory } from '../group-themes';

const cat = (id: number, sortOrder: number): Category =>
  ({
    id,
    name: `c${id}`,
    color: '#000',
    mode: 'both',
    sortOrder,
    createdAt: '',
    updatedAt: '',
  }) as Category;
const theme = (id: number, categoryId: number | null, sortOrder = 0): Theme =>
  ({
    id,
    name: `t${id}`,
    color: '#000',
    sortOrder,
    categoryId,
    createdAt: '',
    updatedAt: '',
  }) as Theme;

describe('groupThemesByCategory', () => {
  it('orders categories and their themes by sortOrder', () => {
    const groups = groupThemesByCategory(
      [theme(1, 20, 2), theme(2, 10), theme(3, 20, 1)],
      [cat(20, 1), cat(10, 0)],
    );
    expect(groups.map((g) => g.category?.id)).toEqual([10, 20]);
    expect(groups[1].themes.map((t) => t.id)).toEqual([3, 1]);
  });

  it('omits categories with no theme to pick', () => {
    const groups = groupThemesByCategory([theme(1, 10)], [cat(10, 0), cat(20, 1)]);
    expect(groups.map((g) => g.category?.id)).toEqual([10]);
  });

  it('puts themes without a known category in a trailing group', () => {
    const groups = groupThemesByCategory(
      [theme(1, null), theme(2, 99), theme(3, 10)],
      [cat(10, 0)],
    );
    expect(groups.map((g) => g.category?.id ?? null)).toEqual([10, null]);
    expect(groups[1].themes.map((t) => t.id)).toEqual([1, 2]);
  });
});
