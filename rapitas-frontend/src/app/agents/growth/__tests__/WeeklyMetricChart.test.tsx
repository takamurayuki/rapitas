/**
 * WeeklyMetricChart.test
 *
 * Verifies the shared weekly chart card's empty-data handling: weeks whose
 * values are all null must show the empty message instead of an empty chart.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { WeeklyMetricChart, type WeeklyMetricPoint } from '../components/WeeklyMetricChart';

function renderChart(data: WeeklyMetricPoint[]) {
  return render(
    <WeeklyMetricChart
      title="Metric"
      icon={Activity}
      iconBgClass="bg-indigo-100"
      iconColorClass="text-indigo-600"
      valueFormat="percent"
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
});
