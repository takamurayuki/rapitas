/**
 * UtilizationChartCard tests
 *
 * Verifies the daily-point → WeeklyMetricChart adaptation: canonical series
 * ordering, role vs agent key selection, the empty state, and that zero days
 * still render as data (not the empty message).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UtilizationChartCard, type UtilizationDailyPoint } from './UtilizationChartCard';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

// NOTE: recharts ResponsiveContainer measures the DOM, which jsdom cannot do;
// stub the chart primitives so the test focuses on series/data wiring.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: ({ dataKey }: { dataKey: string }) => <div data-testid={`area-${dataKey}`} />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

const daily: UtilizationDailyPoint[] = [
  {
    date: '2026-08-01',
    byRole: { implementer: 0.5, researcher: 0.25 },
    byAgent: { 'claude-code': 0.6 },
  },
  {
    date: '2026-08-02',
    byRole: { implementer: 0, researcher: 0 },
    byAgent: { 'claude-code': 0 },
  },
];

describe('UtilizationChartCard', () => {
  it('renders one series per role in canonical order', () => {
    render(<UtilizationChartCard title="Role utilization" daily={daily} keyKind="role" />);

    expect(screen.getByText('Role utilization')).toBeInTheDocument();
    // researcher precedes implementer in the canonical role order.
    const areas = screen
      .getAllByTestId(/^area-/)
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => id !== 'area-chart');
    expect(areas).toEqual(['area-researcher', 'area-implementer']);
  });

  it('charts the byAgent keys when keyKind is agent', () => {
    render(<UtilizationChartCard title="Agent utilization" daily={daily} keyKind="agent" />);

    expect(screen.getByTestId('area-claude-code')).toBeInTheDocument();
    expect(screen.queryByTestId('area-implementer')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no daily points', () => {
    render(<UtilizationChartCard title="Role utilization" daily={[]} keyKind="role" />);

    expect(screen.getByText('agents.utilizationEmpty')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('treats an all-zero window as data, not as the empty state', () => {
    render(<UtilizationChartCard title="Role utilization" daily={[daily[1]]} keyKind="role" />);

    expect(screen.queryByText('agents.utilizationEmpty')).not.toBeInTheDocument();
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });
});
