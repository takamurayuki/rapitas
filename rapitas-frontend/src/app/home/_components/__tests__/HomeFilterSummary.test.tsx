/**
 * HomeFilterSummary.test
 *
 * The line that stands in for the hidden filter names the category and
 * theme (auto-run acts on that theme) and is drawn like the auto-run strip
 * — a white band with a top hairline — so the two read as one (2026-11-21).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Category, Theme } from '@/types';

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const { HomeFilterSummary } = await import('../HomeFilterSummary');
const { HOME_CARD_FRAME } = await import('../home-card-frame');

const category = { id: 1, name: '開発', color: '#2563eb', icon: '' } as unknown as Category;
const theme = { id: 7, name: 'rapitas', color: '#f97316' } as unknown as Theme;

describe('HomeFilterSummary', () => {
  it('names the category and theme and shows the filter on request', () => {
    const onShow = vi.fn();
    render(<HomeFilterSummary category={category} theme={theme} onShow={onShow} />);
    const summary = screen.getByTestId('filter-summary');
    expect(summary.textContent).toContain('開発');
    expect(summary.textContent).toContain('rapitas');
    fireEvent.click(screen.getByRole('button', { name: 'home.filterPanel.show' }));
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  // Asked 2026-11-21: the theme looks as it does selected in the filter, and
  // the separator is an icon, not a faint "›" character.
  it('draws the theme like the selected chip in the filter', () => {
    render(<HomeFilterSummary category={category} theme={theme} onShow={vi.fn()} />);
    const chip = screen.getByTestId('scope-theme-chip');
    expect(chip.textContent).toContain('rapitas');
    expect(chip.style.backgroundColor).toBe('rgb(249, 115, 22)');
    expect(chip.className).toContain('text-white');
    expect(chip.className).toContain('font-bold');
    const summary = screen.getByTestId('filter-summary');
    expect(summary.querySelector('[data-testid="ChevronRight-icon"]')).toBeTruthy();
    expect(summary.textContent).not.toContain('›');
  });

  // Asked 2026-11-21: "フィルターを表示" sat below the middle — its inline
  // wrapper aligned it to the text baseline.
  it('centres the show control vertically', () => {
    render(<HomeFilterSummary category={category} theme={theme} onShow={vi.fn()} />);
    const cls = screen.getByTestId('show-filter-slot').className.split(/\s+/);
    expect(cls).toContain('flex');
    expect(cls).toContain('items-center');
  });

  // Asked 2026-11-21: hidden, the filter keeps the filter card's look.
  it('is drawn in the filter card frame', () => {
    render(<HomeFilterSummary category={category} theme={theme} onShow={vi.fn()} />);
    const cls = screen.getByTestId('filter-summary').className.split(/\s+/);
    for (const c of HOME_CARD_FRAME.split(/\s+/)) expect(cls).toContain(c);
    expect(cls).not.toContain('border-t');
  });
});
