/**
 * HomeFilterPanel.test
 *
 * Asked 2026-11-21: a way to hide the whole filter (category tabs, theme row,
 * FILTER). Hidden, it leaves one line naming the category and theme in view,
 * because auto-run acts on the selected theme and the user must still see it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const props = (): ComponentProps<typeof HomeFilterPanel> =>
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
  }) as unknown as ComponentProps<typeof HomeFilterPanel>;

const hideButton = () => screen.getByRole('button', { name: 'home.filterPanel.hide' });
const showButton = () => screen.getByRole('button', { name: 'home.filterPanel.show' });

beforeEach(() => {
  localStorage.clear();
});

describe('hiding the filter', () => {
  it('shows the whole filter with a hide control by default', () => {
    render(<HomeFilterPanel {...props()} />);
    expect(screen.getByTestId('theme-row')).toBeTruthy();
    expect(hideButton()).toBeTruthy();
  });

  it('collapses to one line naming the category and theme', () => {
    render(<HomeFilterPanel {...props()} />);
    fireEvent.click(hideButton());
    expect(screen.queryByTestId('theme-row')).toBeNull();
    const summary = screen.getByTestId('filter-summary');
    expect(summary.textContent).toContain('開発');
    expect(summary.textContent).toContain('rapitas');
    expect(showButton()).toBeTruthy();
  });

  it('brings the filter back from the summary', () => {
    render(<HomeFilterPanel {...props()} />);
    fireEvent.click(hideButton());
    fireEvent.click(showButton());
    expect(screen.getByTestId('theme-row')).toBeTruthy();
    expect(screen.queryByTestId('filter-summary')).toBeNull();
  });

  it('stays hidden the next time the page opens', () => {
    const first = render(<HomeFilterPanel {...props()} />);
    fireEvent.click(hideButton());
    first.unmount();
    render(<HomeFilterPanel {...props()} />);
    expect(screen.getByTestId('filter-summary')).toBeTruthy();
  });
});
