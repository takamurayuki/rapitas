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

const theme = (id: number, categoryId: number, name: string, color = '#6366F1'): Theme =>
  ({ id, categoryId, name, color, icon: '', isDefault: false }) as unknown as Theme;

/** The chip button for a theme, found by its name. */
const chipFor = (name: string) => screen.getByText(name).closest('button') as HTMLButtonElement;

function renderRow(overrides: {
  themes?: Theme[];
  categoryFilter?: number | null;
  themeFilter?: number | null;
}) {
  return render(
    <HomeThemeFilter
      themes={overrides.themes ?? []}
      categoryFilter={overrides.categoryFilter ?? null}
      themeFilter={overrides.themeFilter ?? null}
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

// Every chip used to wear its own theme colour as its text colour, selected or
// not. With this many themes the row read as scattered colour and the one that
// was actually selected stopped standing out — the only thing the row exists to
// show. Asked for 2026-10-31: one calm colour for the rest, the theme's own
// colour reserved for the selected chip.
describe('HomeThemeFilter chip colours', () => {
  it('leaves an unselected chip without any colour of its own', () => {
    renderRow({ themes: [theme(1, 7, 'API', '#DC2626')], categoryFilter: 7, themeFilter: null });
    const chip = chipFor('API');
    expect(chip.style.color).toBe('');
    expect(chip.style.backgroundColor).toBe('');
  });

  // The row sits directly under the category tabs, and its text was a shade
  // darker than theirs (`slate-600` against their `slate-500`), which made the
  // theme row read as heavier than the tabs above it. The chip keeps its own
  // fill — that part was never the problem — and only the text follows the
  // tabs now (reported 2026-10-31).
  it('writes unselected chips in the category tabs’ own slate', () => {
    renderRow({ themes: [theme(1, 7, 'API')], categoryFilter: 7, themeFilter: null });
    const chip = chipFor('API');
    expect(chip.className).toContain('text-slate-500');
    expect(chip.className).toContain('dark:text-slate-400');
    expect(chip.className).not.toContain('text-slate-600');
  });

  it('keeps the chip’s own fill, which was never what read as heavy', () => {
    renderRow({ themes: [theme(1, 7, 'API')], categoryFilter: 7, themeFilter: null });
    const chip = chipFor('API');
    expect(chip.className).toContain('bg-slate-100');
    expect(chip.className).toContain('dark:bg-slate-800');
  });

  it('keeps every unselected chip identical, whatever colours the themes carry', () => {
    renderRow({
      themes: [theme(1, 7, 'API', '#DC2626'), theme(2, 7, 'UI', '#16A34A')],
      categoryFilter: 7,
      themeFilter: null,
    });
    expect(chipFor('UI').className).toBe(chipFor('API').className);
    expect(chipFor('UI').style.cssText).toBe(chipFor('API').style.cssText);
  });

  // The point of calming the rest: the selected one is now the only colour in
  // the row, so it cannot be missed.
  it('gives the selected chip its theme colour', () => {
    renderRow({
      themes: [theme(1, 7, 'API', '#DC2626'), theme(2, 7, 'UI', '#16A34A')],
      categoryFilter: 7,
      themeFilter: 1,
    });
    expect(chipFor('API').style.backgroundColor).toBe('rgb(220, 38, 38)');
    expect(chipFor('API').style.color).toBe('rgb(255, 255, 255)');
    expect(chipFor('UI').style.backgroundColor).toBe('');
  });
});
