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

vi.mock('next-intl', () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  // `rich` calls the tag back, so a test can see whether the component wrapped
  // a segment at all and what it wrapped it in — which is the point here.
  t.rich = (key: string, values: Record<string, unknown>) => {
    const { count, ...tags } = values;
    const [name, render] = Object.entries(tags)[0] ?? [];
    return (
      <>
        {`${key}:`}
        {typeof render === 'function'
          ? (render as (c: React.ReactNode) => React.ReactNode)(`${name}:${String(count)}`)
          : null}
      </>
    );
  };
  return { useTranslations: () => t };
});

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
    expect(screen.getByText('overdue:2')).toBeTruthy();
  });

  // The two halves are not equally interesting: "nothing due" is a status and
  // "2 overdue" is work being missed — on this machine by three and four
  // months. Set in the same muted slate, the eye stops at the first half and
  // the second is why the line was kept at all.
  it('emphasises only the overdue half, in the attention amber', () => {
    renderBar({ totalCount: 0, overdueCount: 2 });
    const emphasised = screen.getByText('overdue:2');

    expect(emphasised.className).toContain('text-amber-600');
    expect(emphasised.className).toContain('dark:text-amber-400');
    expect(emphasised.className).toContain('font-semibold');
    // It wraps a segment, not the whole sentence.
    expect(emphasised.textContent).not.toContain('noDueTodayWithOverdue');
  });

  it('leaves the rest of the line in the toolbar’s muted slate', () => {
    const { container } = renderBar({ totalCount: 0, overdueCount: 2 });
    const line = container.querySelector('p') as HTMLParagraphElement;
    expect(line.className).toContain('text-zinc-500');
    expect(line.className).not.toContain('text-amber');
  });

  it('says only that nothing is due when nothing is past due either', () => {
    renderBar({ totalCount: 0, overdueCount: 0 });
    expect(screen.getByText('noDueTodayTasks')).toBeTruthy();
    expect(screen.queryByText(/noDueTodayWithOverdue/)).toBeNull();
  });

  // It is one sentence, and it wrapped: `w-60` is the bar's width and the
  // sentence is wider, so "2件" broke onto a line of its own — a number cut
  // off from the words it belongs to. A sentence sizes itself.
  it('stays on one line, and does not take the bar’s fixed width', () => {
    const { container } = renderBar({ totalCount: 0, overdueCount: 2 });
    // Queried as the element rather than by its text: the sentence is assembled
    // from a translation with a tag in it, so it is not one text node.
    const line = container.querySelector('p') as HTMLParagraphElement;
    expect(line.className).toContain('whitespace-nowrap');
    expect(container.querySelector('.w-60')).toBeNull();
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

describe('beside the toolbar buttons', () => {
  // Two rows made the card 62px against the buttons' 38px: on a day with
  // something due the toolbar grew by 24px and pushed a page of ten tasks
  // past the window, so a scrollbar came and went with the due date (#1537).
  it('is as tall as the buttons beside it', () => {
    const { container } = renderBar({ totalCount: 3, efficiency: 33 });
    const card = container.querySelector('[data-today-progress-card]');
    expect(card?.className).toContain('h-[38px]');
  });

  // The fix was to tighten the padding, not to redesign the card: the label
  // still sits above the bar.
  it('keeps the label above the bar', () => {
    const { container } = renderBar({ totalCount: 3, efficiency: 33 });
    const labelRow = screen.getByText('todayDueTask').parentElement?.parentElement;
    expect(labelRow?.contains(bar(container))).toBe(false);
    expect(labelRow?.nextElementSibling).toBe(bar(container));
  });

  // The knob is drawn with an inline colour; a literal there stays the old
  // bright green whatever the palette says.
  it('draws the finished knob in the palette’s green, not a literal', () => {
    const { container } = renderBar({ totalCount: 3, efficiency: 100 });
    const knob = container.querySelector('[data-today-progress-knob]') as HTMLElement;
    expect(knob.getAttribute('style')).toContain('var(--color-green-500)');
  });
});
