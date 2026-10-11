/**
 * BudgetProjectionCard tests
 *
 * Verifies the unconfigured message, the reached level, the forecast days
 * from the 7-day average, and the no-forecast message.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BudgetProjectionCard } from './BudgetProjectionCard';
import type { UsageBudgetStatus } from '../_hooks/useUsageBudget';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
    params ? `${ns}.${key}:${JSON.stringify(params)}` : `${ns}.${key}`,
}));

function status(
  projection: Partial<Extract<UsageBudgetStatus, { configured: true }>['projection']>,
) {
  return {
    configured: true,
    unit: 'tokens',
    monthlyLimit: 1000,
    month: '2026-10',
    projection: {
      used: 900,
      limit: 1000,
      remaining: 100,
      ratio: 0.9,
      level: 'warn90',
      avg7: 40,
      daysToExhaust: 2.5,
      projectedMonthEnd: 1740,
      daysLeftInMonth: 21,
      ...projection,
    },
    shares: [],
    themes: [],
    suggestedShares: [],
    suggestionReason: null,
    snoozedUntil: null,
    pendingPrompt: null,
  } satisfies UsageBudgetStatus;
}

describe('BudgetProjectionCard', () => {
  it('says no budget is configured', () => {
    render(
      <BudgetProjectionCard
        status={{ configured: false, suggestedShares: [], suggestionReason: null }}
      />,
    );
    expect(screen.getByText('usageBudget.notConfigured')).toBeInTheDocument();
  });

  it('shows the level and the forecast days', () => {
    render(<BudgetProjectionCard status={status({})} />);
    expect(screen.getByText('usageBudget.level_warn90')).toBeInTheDocument();
    expect(screen.getByText(/usageBudget\.daysToExhaust/)).toHaveTextContent('"days":"2.5"');
  });

  it('says the forecast is unavailable without recent usage', () => {
    render(
      <BudgetProjectionCard
        status={status({ avg7: 0, daysToExhaust: null, projectedMonthEnd: null })}
      />,
    );
    expect(screen.getByText('usageBudget.noForecast')).toBeInTheDocument();
  });
});
