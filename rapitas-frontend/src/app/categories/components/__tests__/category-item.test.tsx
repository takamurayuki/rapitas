/**
 * category-item.test
 *
 * Pins that the delete action is offered for the seeded default categories
 * (開発・学習) as well as user-created ones. The button used to be hidden for
 * isDefault rows, which left users unable to remove the defaults they never used.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { DraggableProvided } from '@hello-pangea/dnd';
import ja from '../../../../../messages/ja.json';
import { CategoryItem } from '../category-item';
import type { CategoryWithThemes } from '../../hooks/useCategories';

const dragProvided = {
  innerRef: () => {},
  draggableProps: {},
  dragHandleProps: {},
} as unknown as DraggableProvided;

const category = (over: Partial<CategoryWithThemes>): CategoryWithThemes => ({
  id: 1,
  name: '開発',
  color: '#3B82F6',
  icon: 'Code',
  mode: 'development',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  themes: [],
  ...over,
});

const renderItem = (item: CategoryWithThemes, onDelete = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="ja" messages={ja}>
      <CategoryItem
        item={item}
        isDefault={false}
        dragProvided={dragProvided}
        onEdit={vi.fn()}
        onDelete={onDelete}
        onSetDefault={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  return onDelete;
};

describe('CategoryItem delete action', () => {
  it('offers delete for a seeded default category and passes its id and name', () => {
    const onDelete = renderItem(category({ id: 3, name: '学習', isDefault: true }));
    fireEvent.click(screen.getByTitle(ja.common.delete));
    expect(onDelete).toHaveBeenCalledWith(3, '学習');
  });

  it('offers delete for a user-created category', () => {
    renderItem(category({ id: 9, name: '仕事', isDefault: false }));
    expect(screen.getByTitle(ja.common.delete)).toBeTruthy();
  });
});
