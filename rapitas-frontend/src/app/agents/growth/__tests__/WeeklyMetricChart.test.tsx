/**
 * WeeklyMetricChart.test
 *
 * Verifies the shared weekly chart card's empty-data handling: weeks whose
 * values are all null must show the empty message instead of an empty chart.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import type React from 'react';
import { WeeklyMetricChart, type WeeklyMetricPoint } from '../components/WeeklyMetricChart';

// recharts draws nothing at jsdom's 0x0 size, so the axis/tooltip formatters
// are captured here and invoked directly to assert value formatting.
vi.mock('recharts', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: passthrough,
    AreaChart: passthrough,
    Area: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: ({ tickFormatter }: { tickFormatter: (v: unknown) => string }) => (
      <div data-testid="y-tick">{tickFormatter(57)}</div>
    ),
    Tooltip: ({
      formatter,
    }: {
      formatter: (value: unknown, name: unknown) => [string, string];
    }) => <div data-testid="tooltip-value">{formatter(57, 'rate')[0]}</div>,
  };
});

type ValueFormat = 'percent' | 'count' | 'minutes';

function renderChart(data: WeeklyMetricPoint[], valueFormat: ValueFormat = 'percent') {
  return render(
    <WeeklyMetricChart
      title="Metric"
      icon={Activity}
      iconBgClass="bg-indigo-100"
      iconColorClass="text-indigo-600"
      valueFormat={valueFormat}
      emptyMessage="no data for period"
      noDataLabel="no data"
      series={[{ dataKey: 'rate', label: 'Rate', color: '#6366f1' }]}
      data={data}
    />,
  );
}

describe('WeeklyMetricChart', () => {
  it('shows the empty message when there are no data points', () => {
    renderChart([]);
    expect(screen.getByText('Metric')).toBeInTheDocument();
    expect(screen.getByText('no data for period')).toBeInTheDocument();
  });

  it('shows the empty message when every week is null (missing data, not zero)', () => {
    renderChart([
      { weekLabel: '3/13', rate: null },
      { weekLabel: '3/20', rate: null },
    ]);
    expect(screen.getByText('no data for period')).toBeInTheDocument();
  });

  it('renders the chart instead of the empty message once any week has a value', () => {
    // A real zero is data (a bad week), so the chart must render for it.
    renderChart([
      { weekLabel: '3/13', rate: 0 },
      { weekLabel: '3/20', rate: null },
    ]);
    expect(screen.queryByText('no data for period')).not.toBeInTheDocument();
  });

  it("appends the 分 unit to axis ticks and tooltip values for valueFormat='minutes'", () => {
    renderChart([{ weekLabel: '8/30', rate: 57 }], 'minutes');
    expect(screen.getByTestId('y-tick')).toHaveTextContent('57分');
    expect(screen.getByTestId('tooltip-value')).toHaveTextContent('57分');
  });

  it('keeps percent formatting untouched by the minutes branch', () => {
    renderChart([{ weekLabel: '8/30', rate: 0.5 }], 'percent');
    expect(screen.getByTestId('y-tick')).toHaveTextContent('5700%');
    expect(screen.getByTestId('tooltip-value')).toHaveTextContent('5700.0%');
  });

  it('renders headerExtra inside the card header', () => {
    render(
      <WeeklyMetricChart
        title="Metric"
        icon={Activity}
        iconBgClass="bg-indigo-100"
        iconColorClass="text-indigo-600"
        valueFormat="count"
        emptyMessage="no data for period"
        noDataLabel="no data"
        series={[{ dataKey: 'rate', label: 'Rate', color: '#6366f1' }]}
        data={[]}
        headerExtra={<span data-testid="extra">badge</span>}
      />,
    );
    expect(screen.getByTestId('extra')).toBeInTheDocument();
  });
});
