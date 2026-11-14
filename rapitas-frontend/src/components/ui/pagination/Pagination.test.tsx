/**
 * Pagination.test
 *
 * The space above the control is a prop so one list can ask for less without
 * forking the shared component: the home list needs the room so a page of
 * ten tasks fits the window (#1539).
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import Pagination from './Pagination';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

function renderPagination(spacingClassName?: string) {
  return render(
    <Pagination
      currentPage={1}
      totalPages={3}
      itemsPerPage={10}
      onPageChange={vi.fn()}
      onItemsPerPageChange={vi.fn()}
      spacingClassName={spacingClassName}
    />,
  );
}

describe('the space above the pagination', () => {
  it('stays mt-6 for every list that does not ask otherwise', () => {
    const { container } = renderPagination();
    expect((container.firstElementChild as HTMLElement).className).toContain('mt-6');
  });

  it('takes the spacing a list asks for, instead of mt-6', () => {
    const { container } = renderPagination('mt-4');
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('mt-4');
    expect(root.className).not.toContain('mt-6');
  });
});
