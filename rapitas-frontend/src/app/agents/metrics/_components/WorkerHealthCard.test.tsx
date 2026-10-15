/**
 * WorkerHealthCard / WorkerHealthSmallMultiples / worker-health-focus tests
 *
 * Verifies weight disclosure, the four-metric breakdown, selection callback,
 * the pending/empty/error states and the alert deep-link parser.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkerHealthCard } from './WorkerHealthCard';
import { parseWorkerHealthFocus } from './worker-health-focus';
import type { WorkerHealthData, WorkerHealthPoint } from '../_hooks/useWorkerHealth';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
    params ? `${ns}.${key}:${JSON.stringify(params)}` : `${ns}.${key}`,
}));

// NOTE: recharts measures the DOM, which jsdom cannot do; stub the primitives.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: ({ dataKey }: { dataKey: string }) => <div data-testid={`line-${dataKey}`} />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
}));

function point(i: number, composite: number | null): WorkerHealthPoint {
  return {
    t: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
    raw: { completions: 10, timeoutRate: 0.1, retryRate: 0, restarts: 0 },
    z: { completions: 0.5, timeoutRate: 2, retryRate: 0, restarts: null },
    composite,
  };
}

function data(composites: Array<number | null>, fired = false): WorkerHealthData {
  return {
    unit: 'worker',
    recordingStartedAt: null,
    weights: { completions: 0.25, timeoutRate: 0.25, retryRate: 0.25, restarts: 0.25 },
    rules: { runThreshold: 1.5, runLength: 3, acfLowThreshold: 0.3, acfMinDrop: 0.4 },
    points: composites.map((c, i) => point(i, c)),
    detection: {
      run: { fired, endIndex: fired ? composites.length - 1 : -1 },
      periodicity: { fired: false, recent: null, previous: null },
    },
  };
}

describe('WorkerHealthCard', () => {
  it('shows every metric weight explicitly', () => {
    render(
      <WorkerHealthCard
        data={data([0.2, 0.4])}
        status="success"
        selectedMetric={null}
        onSelectMetric={() => {}}
      />,
    );
    const weights = screen.getByTestId('worker-health-weights');
    expect(weights.querySelectorAll('li')).toHaveLength(4);
    expect(weights.textContent).toContain('0.25');
    expect(screen.getByTestId('line-composite')).toBeInTheDocument();
  });

  it('renders the four per-metric breakdown panels and reports selection', () => {
    const onSelect = vi.fn();
    render(
      <WorkerHealthCard
        data={data([0.2, 0.4])}
        status="success"
        selectedMetric="timeoutRate"
        onSelectMetric={onSelect}
      />,
    );
    expect(screen.getByTestId('worker-health-metric-completions')).toBeInTheDocument();
    expect(screen.getByTestId('worker-health-metric-restarts')).toBeInTheDocument();
    expect(screen.getByTestId('worker-health-metric-timeoutRate')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByTestId('worker-health-metric-retryRate'));
    expect(onSelect).toHaveBeenCalledWith('retryRate');
  });

  it('shows the pending notice instead of a line when every point is pending', () => {
    render(
      <WorkerHealthCard
        data={data([null, null])}
        status="success"
        selectedMetric={null}
        onSelectMetric={() => {}}
      />,
    );
    expect(screen.getByTestId('worker-health-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('line-composite')).toBeNull();
  });

  it('shows the deviation banner when a detector fired', () => {
    render(
      <WorkerHealthCard
        data={data([2, 2, 2], true)}
        status="success"
        selectedMetric={null}
        onSelectMetric={() => {}}
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the empty and error states without a chart', () => {
    const { rerender } = render(
      <WorkerHealthCard
        data={null}
        status="empty"
        selectedMetric={null}
        onSelectMetric={() => {}}
      />,
    );
    expect(screen.getByText('agents.workerHealthEmpty')).toBeInTheDocument();
    rerender(
      <WorkerHealthCard
        data={null}
        status="error"
        selectedMetric={null}
        onSelectMetric={() => {}}
      />,
    );
    expect(screen.getByText('agents.workerHealthError')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });
});

describe('parseWorkerHealthFocus', () => {
  const q = (s: string) => new URLSearchParams(s);

  it('returns null for other panels or no panel', () => {
    expect(parseWorkerHealthFocus(q(''))).toBeNull();
    expect(parseWorkerHealthFocus(q('panel=other&metric=restarts'))).toBeNull();
  });

  it('parses metric and time from an alert link', () => {
    expect(
      parseWorkerHealthFocus(
        q('panel=worker-health&metric=timeoutRate&at=2026-10-12T09:00:00.000Z'),
      ),
    ).toEqual({ panel: 'worker-health', metric: 'timeoutRate', at: '2026-10-12T09:00:00.000Z' });
  });

  it('drops an unknown metric and an invalid time but keeps the panel focus', () => {
    expect(parseWorkerHealthFocus(q('panel=worker-health&metric=bogus&at=nope'))).toEqual({
      panel: 'worker-health',
      metric: null,
      at: null,
    });
  });
});
