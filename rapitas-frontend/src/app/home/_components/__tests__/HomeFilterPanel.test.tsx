/**
 * HomeFilterPanel.test
 *
 * Asked 2026-11-21: a way to hide the whole filter (category tabs, theme row,
 * FILTER). The panel only offers the hide control and steps aside; the line
 * that names the category and theme while hidden is drawn by the toolbar,
 * merged into the auto-run strip.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Category, Theme } from '@/types';

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});
vi.mock('../HomeThemeFilter', () => ({
  HomeThemeFilter: () => <div data-testid="theme-row" />,
}));

const { HomeFilterPanel } = await import('../HomeFilterPanel');

const categories = [
  { id: 1, name: '開発', color: '#2563eb', icon: '', mode: 'both' },
] as unknown as Category[];
const themes = [{ id: 7, name: 'rapitas', color: '#f97316', categoryId: 1 }] as unknown as Theme[];

const props = (
  over: Partial<ComponentProps<typeof HomeFilterPanel>> = {},
): ComponentProps<typeof HomeFilterPanel> =>
  ({
    categories,
    themes,
    categoryFilter: 1,
    themeFilter: 7,
    filter: 'all',
    priorityFilter: null,
    labels: [],
    labelFilter: null,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    appMode: 'all',
    globalSettings: null,
    filtersLoading: false,
    filtersError: null,
    isFilterExpanded: false,
    isScrollNeeded: false,
    canScrollLeft: false,
    canScrollRight: false,
    statusCounts: { all: 0 },
    themeScrollRef: { current: null },
    filterHidden: false,
    onFilterHiddenChange: vi.fn(),
    onCategoryChange: vi.fn(),
    onThemeChange: vi.fn(),
    onFilterChange: vi.fn(),
    onPriorityChange: vi.fn(),
    onLabelChange: vi.fn(),
    onSortByChange: vi.fn(),
    onSortOrderToggle: vi.fn(),
    onFilterExpandedToggle: vi.fn(),
    onScrollLeft: vi.fn(),
    onScrollRight: vi.fn(),
    onRetry: vi.fn(),
    ...over,
  }) as unknown as ComponentProps<typeof HomeFilterPanel>;

describe('hiding the filter', () => {
  it('shows the whole filter with a hide control', () => {
    render(<HomeFilterPanel {...props()} />);
    expect(screen.getByTestId('theme-row')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'home.filterPanel.hide' })).toBeTruthy();
  });

  // The frame the auto-run strip and the hidden summary share (2026-11-21).
  it('is drawn in the shared card frame', async () => {
    const { HOME_CARD_FRAME } = await import('../home-card-frame');
    const { container } = render(<HomeFilterPanel {...props()} />);
    const cls = (container.firstElementChild as HTMLElement).className.split(/\s+/);
    for (const c of HOME_CARD_FRAME.split(/\s+/)) expect(cls).toContain(c);
  });

  it('asks to be hidden when the control is pressed', () => {
    const onFilterHiddenChange = vi.fn();
    render(<HomeFilterPanel {...props({ onFilterHiddenChange })} />);
    fireEvent.click(screen.getByRole('button', { name: 'home.filterPanel.hide' }));
    expect(onFilterHiddenChange).toHaveBeenCalledWith(true);
  });

  // The toolbar's band names the category and theme instead.
  it('draws nothing while hidden', () => {
    const { container } = render(<HomeFilterPanel {...props({ filterHidden: true })} />);
    expect(container.firstChild).toBeNull();
  });

  it('still reports a load error while hidden', () => {
    render(<HomeFilterPanel {...props({ filterHidden: true, filtersError: 'boom' })} />);
    expect(screen.getByText(/boom/)).toBeTruthy();
  });
});
