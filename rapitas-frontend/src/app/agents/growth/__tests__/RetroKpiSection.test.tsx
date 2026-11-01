/**
 * RetroKpiSection.test
 *
 * Verifies the retro KPI section's loading/error/empty states, that all six
 * KPI cards render with the auto-merge card carrying two series, and that the
 * diff badges are wired with the right improvement direction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';
import type { RetroKpiLedger, RetroKpiWindow } from '../types';
import type { WeeklyMetricPoint, WeeklyMetricSeries } from '../components/WeeklyMetricChart';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

const mockUseRetroKpiData = vi.fn();
vi.mock('../useRetroKpiData', () => ({
  useRetroKpiData: () => mockUseRetroKpiData(),
}));

interface CapturedChart {
  title: string;
  data: WeeklyMetricPoint[];
  series: WeeklyMetricSeries[];
  valueFormat: string;
  headerExtra?: React.ReactNode;
}
const chartProps: CapturedChart[] = [];
vi.mock('../components/WeeklyMetricChart', () => ({
  WeeklyMetricChart: (props: CapturedChart) => {
    chartProps.push(props);
    return (
      <div data-testid="metric-chart">
        {props.title}
        {props.headerExtra}
      </div>
    );
  },
}));

import { RetroKpiSection } from '../components/RetroKpiSection';

function makeWindow(over: Partial<RetroKpiWindow> & { to: string }): RetroKpiWindow {
  return {
    from: '2026-01-01T00:00:00.000Z',
    repairRate: { completedTasks: 0, repairedTasks: 0, rate: null },
    autoMerged: 0,
    autoMergeExhausted: 0,
    autoMergeConflictFiled: 0,
    verifyNoChangeConfirmed: 0,
    verifyRepairNonConvergence: 0,
    leadTimeMinutes: { sampleSize: 0, medianMinutes: null },
    ...over,
  };
}

function setHookState(state: {
  ledger: RetroKpiLedger | null;
  loading: boolean;
  error: string | null;
}) {
  mockUseRetroKpiData.mockReturnValue(state);
}

describe('RetroKpiSection', () => {
  beforeEach(() => {
    chartProps.length = 0;
    mockUseRetroKpiData.mockReset();
  });

  it('shows the section title and no charts while loading', () => {
    setHookState({ ledger: null, loading: true, error: null });
    render(<RetroKpiSection />);
    expect(screen.getByText('agents.growth.retroKpi.sectionTitle')).toBeInTheDocument();
    expect(screen.queryByTestId('metric-chart')).not.toBeInTheDocument();
  });

  it('shows the error banner and no charts on fetch failure', () => {
    setHookState({ ledger: null, loading: false, error: 'boom' });
    render(<RetroKpiSection />);
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByTestId('metric-chart')).not.toBeInTheDocument();
  });

  it('shows the empty hint when the API returns zero windows', () => {
    setHookState({ ledger: { windowDays: 7, windows: [] }, loading: false, error: null });
    render(<RetroKpiSection />);
    expect(screen.getByText('agents.growth.retroKpi.emptyHint')).toBeInTheDocument();
    expect(screen.queryByTestId('metric-chart')).not.toBeInTheDocument();
  });

  it('renders six KPI cards, the auto-merge card with two series', () => {
    setHookState({
      ledger: { windowDays: 7, windows: [makeWindow({ to: '2026-08-30T12:00:00.000Z' })] },
      loading: false,
      error: null,
    });
    render(<RetroKpiSection />);
    expect(screen.getAllByTestId('metric-chart')).toHaveLength(6);
    for (const key of [
      'repairRate',
      'autoMerge',
      'conflictFiled',
      'noChangeConfirmed',
      'nonConvergence',
      'leadTime',
    ]) {
      expect(screen.getByText(`agents.growth.retroKpi.${key}.title`)).toBeInTheDocument();
    }
    const autoMerge = chartProps.find((p) => p.title === 'agents.growth.retroKpi.autoMerge.title');
    expect(autoMerge?.series.map((s) => s.dataKey)).toEqual(['merged', 'exhausted']);
    const leadTime = chartProps.find((p) => p.title === 'agents.growth.retroKpi.leadTime.title');
    expect(leadTime?.valueFormat).toBe('minutes');
  });

  it('hides diff badges when only one window exists', () => {
    setHookState({
      ledger: { windowDays: 7, windows: [makeWindow({ to: '2026-08-30T12:00:00.000Z' })] },
      loading: false,
      error: null,
    });
    render(<RetroKpiSection />);
    expect(screen.queryByTestId('kpi-diff-badge')).not.toBeInTheDocument();
  });

  it('renders seven diff badges with direction-aware tones for two windows', () => {
    const thisWeek = makeWindow({
      to: '2026-08-30T12:00:00.000Z',
      repairRate: { completedTasks: 10, repairedTasks: 3, rate: 0.3 },
      autoMerged: 100,
      autoMergeExhausted: 10,
      autoMergeConflictFiled: 6,
      verifyNoChangeConfirmed: 40,
      verifyRepairNonConvergence: 12,
      leadTimeMinutes: { sampleSize: 10, medianMinutes: 50 },
    });
    const lastWeek = makeWindow({
      to: '2026-08-23T12:00:00.000Z',
      repairRate: { completedTasks: 10, repairedTasks: 4, rate: 0.34 },
      autoMerged: 92,
      autoMergeExhausted: 16,
      autoMergeConflictFiled: 4,
      verifyNoChangeConfirmed: 29,
      verifyRepairNonConvergence: 15,
      leadTimeMinutes: { sampleSize: 10, medianMinutes: 57 },
    });
    setHookState({
      ledger: { windowDays: 7, windows: [thisWeek, lastWeek] },
      loading: false,
      error: null,
    });
    render(<RetroKpiSection />);
    const badges = screen.getAllByTestId('kpi-diff-badge');
    // 6 cards, auto-merge carries two badges (merged + exhausted).
    expect(badges).toHaveLength(7);
    const tones = badges.map((b) => b.getAttribute('data-tone'));
    // repairRate ↓ improved, merged ↑ improved, exhausted ↓ improved,
    // conflicts ↑ worsened, noChange neutral, nonConvergence ↓ improved, leadTime ↓ improved.
    expect(tones).toEqual([
      'improved',
      'improved',
      'improved',
      'worsened',
      'neutral',
      'improved',
      'improved',
    ]);
  });

  it('shapes chart data oldest-first with null passthrough', () => {
    const newest = makeWindow({
      to: '2026-08-30T12:00:00.000Z',
      // NOTE: sampleSize was 3 here, which the sample gate now withholds
      // (#1304). Raised above the threshold so this test keeps testing what it
      // is named for — ordering and null passthrough — and the gating itself is
      // asserted in the describe below.
      leadTimeMinutes: { sampleSize: 10, medianMinutes: 57 },
    });
    const oldest = makeWindow({ to: '2026-08-23T12:00:00.000Z' });
    setHookState({
      ledger: { windowDays: 7, windows: [newest, oldest] },
      loading: false,
      error: null,
    });
    render(<RetroKpiSection />);
    const leadTime = chartProps.find((p) => p.title === 'agents.growth.retroKpi.leadTime.title');
    expect(leadTime?.data).toEqual([
      { weekLabel: '8/23', median: null },
      { weekLabel: '8/30', median: 57 },
    ]);
  });
});

/**
 * The improvement digest already dropped thin-sample rates; this section did
 * not. Live data on 2026-10-31: a 590-minute lead-time median over 2 tasks sat
 * on the same line as 35 minutes over 28, and fed the "vs last week" badge —
 * so sampling noise was rendered as a regression (#1304).
 */
describe('RetroKpiSection sample gating', () => {
  beforeEach(() => {
    chartProps.length = 0;
    mockUseRetroKpiData.mockReset();
  });

  const seriesOf = (title: string) =>
    chartProps.find((p) => p.title === `agents.growth.retroKpi.${title}.title`)?.data;

  it('withholds a repair rate and a median computed over too few tasks', () => {
    setHookState({
      ledger: {
        windowDays: 7,
        windows: [
          makeWindow({
            to: '2026-10-31T00:00:00.000Z',
            repairRate: { completedTasks: 2, repairedTasks: 1, rate: 0.5 },
            leadTimeMinutes: { sampleSize: 2, medianMinutes: 590 },
          }),
        ],
      },
      loading: false,
      error: null,
    });
    render(<RetroKpiSection />);

    expect(seriesOf('repairRate')).toEqual([{ weekLabel: '10/31', rate: null }]);
    expect(seriesOf('leadTime')).toEqual([{ weekLabel: '10/31', median: null }]);
  });

  // Counts are not rates: 2 auto-merges is exactly 2, whatever the week's size.
  it('leaves the count series untouched on the same thin week', () => {
    setHookState({
      ledger: {
        windowDays: 7,
        windows: [
          makeWindow({
            to: '2026-10-31T00:00:00.000Z',
            repairRate: { completedTasks: 2, repairedTasks: 1, rate: 0.5 },
            autoMergeConflictFiled: 2,
            verifyRepairNonConvergence: 3,
          }),
        ],
      },
      loading: false,
      error: null,
    });
    render(<RetroKpiSection />);

    expect(seriesOf('conflictFiled')).toEqual([{ weekLabel: '10/31', conflicts: 2 }]);
    expect(seriesOf('nonConvergence')).toEqual([{ weekLabel: '10/31', nonConvergence: 3 }]);
  });

  // The diff badge is the worst place for a thin sample: it turns noise into a
  // verdict about the week just gone.
  it('does not let a thin week decide the week-on-week verdict', () => {
    setHookState({
      ledger: {
        windowDays: 7,
        windows: [
          makeWindow({
            to: '2026-10-31T00:00:00.000Z',
            repairRate: { completedTasks: 2, repairedTasks: 1, rate: 0.5 },
            leadTimeMinutes: { sampleSize: 2, medianMinutes: 590 },
          }),
          makeWindow({
            to: '2026-10-24T00:00:00.000Z',
            repairRate: { completedTasks: 28, repairedTasks: 10, rate: 0.357 },
            leadTimeMinutes: { sampleSize: 28, medianMinutes: 35 },
          }),
        ],
      },
      loading: false,
      error: null,
    });
    render(<RetroKpiSection />);

    const tones = screen.getAllByTestId('kpi-diff-badge').map((b) => b.getAttribute('data-tone'));
    // repairRate (index 0) and leadTime (last) both compare against a withheld
    // current value, so neither can read as improved or worsened.
    expect(tones[0]).toBe('neutral');
    expect(tones[tones.length - 1]).toBe('neutral');
  });

  it('still states a rate and a median once the sample is there', () => {
    setHookState({
      ledger: {
        windowDays: 7,
        windows: [
          makeWindow({
            to: '2026-10-24T00:00:00.000Z',
            repairRate: { completedTasks: 28, repairedTasks: 10, rate: 0.357 },
            leadTimeMinutes: { sampleSize: 28, medianMinutes: 35 },
          }),
        ],
      },
      loading: false,
      error: null,
    });
    render(<RetroKpiSection />);

    expect(seriesOf('repairRate')).toEqual([{ weekLabel: '10/24', rate: 0.357 }]);
    expect(seriesOf('leadTime')).toEqual([{ weekLabel: '10/24', median: 35 }]);
  });
});
