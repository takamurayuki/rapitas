/**
 * TodayTaskProgressBar.compact.test
 *
 * A day with nothing due used to still draw the thermometer — an empty bar
 * that could only ever read as 0%, next to the line saying there was nothing
 * to fill it with. On such a day the widget is a sentence, not a gauge, and
 * the sentence now carries the one number that still matters: what is already
 * past due (asked for 2026-10-31).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TodayTaskProgressBarCompact from './TodayTaskProgressBar.compact';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: React.ComponentProps<'div'>) => <div {...p}>{children}</div>,
    span: ({ children, ...p }: React.ComponentProps<'span'>) => <span {...p}>{children}</span>,
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

function renderBar(overrides: {
  totalCount?: number;
  overdueCount?: number;
  efficiency?: number;
  isLoading?: boolean;
}) {
  return render(
    <TodayTaskProgressBarCompact
      className="w-60"
      isLoading={overrides.isLoading ?? false}
      totalCount={overrides.totalCount ?? 0}
      overdueCount={overrides.overdueCount ?? 0}
      efficiency={overrides.efficiency ?? 0}
      tasks={[]}
      isCelebrating={false}
      isHovered={false}
      setIsHovered={vi.fn()}
    />,
  );
}

/** The thermometer track: the only rounded-full element the widget draws. */
const bar = (container: HTMLElement) => container.querySelector('.rounded-full');

describe('a day with nothing due', () => {
  it('draws no bar, because there is nothing for it to show', () => {
    const { container } = renderBar({ totalCount: 0 });
    expect(bar(container)).toBeNull();
  });

  it('says what is still past due', () => {
    renderBar({ totalCount: 0, overdueCount: 2 });
    expect(screen.getByText('noDueTodayWithOverdue:{"count":2}')).toBeTruthy();
  });

  it('says only that nothing is due when nothing is past due either', () => {
    renderBar({ totalCount: 0, overdueCount: 0 });
    expect(screen.getByText('noDueTodayTasks')).toBeTruthy();
    expect(screen.queryByText(/noDueTodayWithOverdue/)).toBeNull();
  });
});

describe('a day with something due', () => {
  // The bar is the point when there is progress to show; emptying the other
  // branch must not take it away here.
  it('still draws the bar', () => {
    const { container } = renderBar({ totalCount: 3, efficiency: 33 });
    expect(bar(container)).not.toBeNull();
  });
});
