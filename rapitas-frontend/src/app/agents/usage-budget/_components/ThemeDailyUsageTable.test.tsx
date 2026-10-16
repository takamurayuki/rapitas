/**
 * ThemeDailyUsageTable tests
 *
 * Verifies daily × theme rows (tokens / runs / duration) and the cost display
 * rule: no recorded cost → tokens only with a note (never ¥0); all recorded →
 * yen; partly recorded → yen plus a partial note. Also the 未分類 label and
 * the period selector.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ThemeDailyUsageTable } from './ThemeDailyUsageTable';
import type { ThemeUsageData, UsageCell } from '../_hooks/useUsageBudget';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
    params ? `${ns}.${key}:${JSON.stringify(params)}` : `${ns}.${key}`,
}));

function cell(c: Partial<UsageCell> = {}): UsageCell {
  return {
    tokens: 1000,
    executions: 2,
    durationMs: 120_000,
    costUsd: 0,
    costKnownCount: 0,
    executionCount: 2,
    ...c,
  };
}

function data(c: Partial<UsageCell>, unclassifiedCost: Partial<UsageCell> = {}): ThemeUsageData {
  const alpha = cell(c);
  const unclassified = cell({
    tokens: 10,
    executions: 1,
    executionCount: 1,
    durationMs: 0,
    ...unclassifiedCost,
  });
  return {
    days: 7,
    usdJpyRate: 150,
    unresolvedCount: 0,
    themes: [
      { themeId: 7, themeName: 'Alpha', ...alpha },
      { themeId: 0, themeName: null, ...unclassified },
    ],
    daily: [
      {
        date: '2026-10-09',
        byTheme: {},
        total: cell({ tokens: 0, executions: 0, executionCount: 0 }),
      },
      { date: '2026-10-10', byTheme: { '7': alpha, '0': unclassified }, total: alpha },
    ],
  };
}

function renderTable(
  c: Partial<UsageCell>,
  onDaysChange = vi.fn(),
  unclassifiedCost: Partial<UsageCell> = {},
) {
  render(
    <ThemeDailyUsageTable usage={data(c, unclassifiedCost)} days={7} onDaysChange={onDaysChange} />,
  );
  return onDaysChange;
}

describe('ThemeDailyUsageTable', () => {
  it('lists each day × theme with tokens, runs and duration', () => {
    renderTable({});
    const row = screen.getByTestId('usage-row-2026-10-10-7');
    expect(within(row).getByText('Alpha')).toBeInTheDocument();
    expect(row).toHaveTextContent('1,000');
    expect(row).toHaveTextContent('usageBudget.durationMinutes:{"value":"2"}');
    expect(screen.getByTestId('usage-row-2026-10-10-0')).toHaveTextContent(
      'usageBudget.unclassified',
    );
  });

  it('shows tokens only, with a note, when no actual cost was recorded', () => {
    renderTable({ costUsd: 0, costKnownCount: 0 });
    expect(screen.queryByText(/¥/)).toBeNull();
    expect(screen.queryByText('usageBudget.colCost')).toBeNull();
    expect(screen.getByText('usageBudget.costUnavailable')).toBeInTheDocument();
  });

  it('shows yen when every run has an actual cost', () => {
    renderTable({ costUsd: 2, costKnownCount: 2 }, vi.fn(), { costUsd: 0.1, costKnownCount: 1 });
    expect(screen.getByText('usageBudget.colCost')).toBeInTheDocument();
    expect(screen.getByTestId('usage-row-2026-10-10-7')).toHaveTextContent('¥300');
    expect(screen.queryByText(/usageBudget\.costPartial/)).toBeNull();
    expect(screen.queryByText('usageBudget.costUnavailable')).toBeNull();
  });

  it('shows yen plus a partial note when only some runs have a cost', () => {
    renderTable({ costUsd: 1, costKnownCount: 1 });
    expect(screen.getByTestId('usage-row-2026-10-10-7')).toHaveTextContent('¥150');
    // The theme-less row has no recorded cost: it must not read ¥0.
    expect(screen.getByTestId('usage-row-2026-10-10-0')).not.toHaveTextContent('¥');
    expect(screen.getByText(/usageBudget\.costPartial/)).toHaveTextContent('"known":1,"total":3');
  });

  it('changes the period', () => {
    const onDaysChange = renderTable({});
    fireEvent.change(screen.getByLabelText('usageBudget.periodLabel'), { target: { value: '30' } });
    expect(onDaysChange).toHaveBeenCalledWith(30);
  });

  it('says so when the period has no executions', () => {
    render(
      <ThemeDailyUsageTable
        usage={{ days: 7, usdJpyRate: 150, unresolvedCount: 0, themes: [], daily: [] }}
        days={7}
        onDaysChange={vi.fn()}
      />,
    );
    expect(screen.getByText('usageBudget.noUsage')).toBeInTheDocument();
  });
});
