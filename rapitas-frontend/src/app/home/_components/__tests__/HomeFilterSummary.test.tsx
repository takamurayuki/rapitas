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

  it('is drawn like the auto-run strip, with no outline', () => {
    render(<HomeFilterSummary category={category} theme={theme} onShow={vi.fn()} />);
    const cls = screen.getByTestId('filter-summary').className.split(/\s+/);
    expect(cls).toContain('border-t');
    expect(cls).not.toContain('border');
    expect(cls).not.toContain('shadow-sm');
    expect(cls).toContain('text-[13px]');
  });
});
