/**
 * HomeThemeFilter theme row
 *
 * A category with no themes used to replace the whole row with the hardcoded
 * placeholders NO_THEMES_FOUND and an amber ADD_THEME button — neither of them
 * translated, and the button a second route to the same /themes page the empty
 * state below the list already offers.
 *
 * These tests pin that there is exactly ONE add-theme control in the row, in
 * both the empty and the populated case.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Theme } from '@/types';
import { HomeThemeFilter } from '../HomeThemeFilter';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/feature/terminal', () => ({
  useTerminalContextStore: { getState: () => ({ setTerminalContext: vi.fn() }) },
}));

vi.mock('@/components/category/icon-data', () => ({
  getIconComponent: () => null,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('../HomeExpandedFilters', () => ({
  HomeExpandedFilters: () => <div data-testid="expanded-filters" />,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const theme = (id: number, categoryId: number, name: string): Theme =>
  ({ id, categoryId, name, color: '#6366F1', icon: '', isDefault: false }) as unknown as Theme;

function renderRow(overrides: { themes?: Theme[]; categoryFilter?: number | null }) {
  return render(
    <HomeThemeFilter
      themes={overrides.themes ?? []}
      categoryFilter={overrides.categoryFilter ?? null}
      themeFilter={null}
      filter="all"
      priorityFilter={null}
      labels={[]}
      labelFilter={null}
      sortBy="createdAt"
      sortOrder="desc"
      isFilterExpanded={false}
      isScrollNeeded={false}
      canScrollLeft={false}
      canScrollRight={false}
      statusCounts={{ all: 0 }}
      themeScrollRef={{ current: null } as unknown as React.RefObject<HTMLDivElement>}
      onThemeChange={vi.fn()}
      onFilterChange={vi.fn()}
      onPriorityChange={vi.fn()}
      onLabelChange={vi.fn()}
      onSortByChange={vi.fn()}
      onSortOrderToggle={vi.fn()}
      onFilterExpandedToggle={vi.fn()}
      onScrollLeft={vi.fn()}
      onScrollRight={vi.fn()}
    />,
  );
}

describe('HomeThemeFilter', () => {
  it('shows no placeholder text when the selected category has no themes', () => {
    renderRow({ themes: [theme(1, 7, 'API')], categoryFilter: 9 });
    expect(screen.queryByText('NO_THEMES_FOUND')).toBeNull();
    expect(screen.queryByText('ADD_THEME')).toBeNull();
  });

  it('offers exactly one add-theme control when the category has no themes', () => {
    renderRow({ themes: [theme(1, 7, 'API')], categoryFilter: 9 });
    expect(screen.getAllByLabelText('addTheme')).toHaveLength(1);
  });

  it('offers exactly one add-theme control when the category has themes', () => {
    renderRow({ themes: [theme(1, 7, 'API')], categoryFilter: 7 });
    expect(screen.getByText('API')).toBeTruthy();
    expect(screen.getAllByLabelText('addTheme')).toHaveLength(1);
  });
});
