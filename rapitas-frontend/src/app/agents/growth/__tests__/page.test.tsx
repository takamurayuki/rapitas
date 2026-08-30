/**
 * page.test
 *
 * Verifies the /agents/growth page: chart data shaping (window order,
 * week labels, null passthrough) and the loading/error/empty states.
 * Chart rendering itself is covered by WeeklyMetricChart.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GrowthLedger, GrowthLedgerWindow } from '../types';
import type { WeeklyMetricPoint } from '../components/WeeklyMetricChart';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

const mockUseGrowthLedgerData = vi.fn();
vi.mock('../useGrowthLedgerData', () => ({
  useGrowthLedgerData: () => mockUseGrowthLedgerData(),
}));

// Captures the props each chart receives so data shaping is assertable
// without rendering recharts (which draws nothing at jsdom's 0x0 size).
const chartProps: Array<{ title: string; data: WeeklyMetricPoint[] }> = [];
vi.mock('../components/WeeklyMetricChart', () => ({
  WeeklyMetricChart: (props: { title: string; data: WeeklyMetricPoint[] }) => {
    chartProps.push(props);
    return <div data-testid="metric-chart">{props.title}</div>;
  },
}));

// The retro KPI section fetches its own data; stub it so this file stays
// focused on the growth-ledger cards (see RetroKpiSection.test.tsx).
vi.mock('../components/RetroKpiSection', () => ({
  RetroKpiSection: () => <div data-testid="retro-kpi-section" />,
}));

import AgentGrowthPage from '../page';

/** Builds one API-shaped window with all-null rates unless overridden. */
function makeWindow(overrides: Partial<GrowthLedgerWindow> & { to: string }): GrowthLedgerWindow {
  return {
    from: '2026-01-01T00:00:00.000Z',
    autonomy: { completed: 0, autonomous: 0, rate: null },
    criticFirstPass: {
      research: { total: 0, firstPass: 0, rate: null },
      plan: { total: 0, firstPass: 0, rate: null },
    },
    repairEfficiency: { completedTasks: 0, totalRepairs: 0, avgPerTask: null },
    defectRecurrence: { newConcerns: 0, recurring: 0, rate: null },
    kbQuality: { total: 0, validated: 0, rate: null },
    ...overrides,
  };
}

function setHookState(state: {
  ledger: GrowthLedger | null;
  loading: boolean;
  error: string | null;
}) {
  mockUseGrowthLedgerData.mockReturnValue(state);
}

describe('AgentGrowthPage', () => {
  beforeEach(() => {
    chartProps.length = 0;
    mockUseGrowthLedgerData.mockReset();
  });

  it('shows the skeleton and no charts while loading', () => {
    setHookState({ ledger: null, loading: true, error: null });
    render(<AgentGrowthPage />);
    expect(screen.queryByTestId('metric-chart')).not.toBeInTheDocument();
    expect(screen.queryByText('agents.growth.pageTitle')).not.toBeInTheDocument();
  });

  it('shows the error banner and no charts on fetch failure', () => {
    setHookState({ ledger: null, loading: false, error: 'boom' });
    render(<AgentGrowthPage />);
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByTestId('metric-chart')).not.toBeInTheDocument();
  });

  it('shows the empty state when the API returns zero windows', () => {
    setHookState({ ledger: { windowDays: 7, windows: [] }, loading: false, error: null });
    render(<AgentGrowthPage />);
    expect(screen.getByText('agents.growth.emptyTitle')).toBeInTheDocument();
    expect(screen.getByText('agents.growth.emptyHint')).toBeInTheDocument();
    expect(screen.queryByTestId('metric-chart')).not.toBeInTheDocument();
  });

  it('renders all five metric charts when windows exist', () => {
    setHookState({
      ledger: { windowDays: 7, windows: [makeWindow({ to: '2026-03-20T00:00:00.000Z' })] },
      loading: false,
      error: null,
    });
    render(<AgentGrowthPage />);
    expect(screen.getAllByTestId('metric-chart')).toHaveLength(5);
    expect(screen.getByText('agents.growth.autonomy.title')).toBeInTheDocument();
    expect(screen.getByText('agents.growth.kbQuality.title')).toBeInTheDocument();
  });

  it('shapes chart data oldest-first with M/D labels and null passthrough', () => {
    // API contract: windows arrive newest first.
    // Noon UTC keeps the local-time M/D label stable across UTC±11 runners.
    const newest = makeWindow({
      to: '2026-03-20T12:00:00.000Z',
      autonomy: { completed: 4, autonomous: 3, rate: 0.75 },
    });
    const oldest = makeWindow({
      to: '2026-03-13T12:00:00.000Z',
      autonomy: { completed: 0, autonomous: 0, rate: null },
    });
    setHookState({
      ledger: { windowDays: 7, windows: [newest, oldest] },
      loading: false,
      error: null,
    });
    render(<AgentGrowthPage />);

    const autonomyChart = chartProps.find((p) => p.title === 'agents.growth.autonomy.title');
    expect(autonomyChart).toBeDefined();
    // Oldest week first for a left-to-right time axis; null (missing week)
    // must survive shaping — it must not be coerced to 0.
    expect(autonomyChart?.data).toEqual([
      { weekLabel: '3/13', autonomy: null },
      { weekLabel: '3/20', autonomy: 0.75 },
    ]);

    const criticChart = chartProps.find((p) => p.title === 'agents.growth.criticFirstPass.title');
    expect(criticChart?.data[0]).toEqual({ weekLabel: '3/13', research: null, plan: null });
  });
});
