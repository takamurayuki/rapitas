/**
 * page.test
 *
 * Verifies the /agents/pareto page: loading skeleton, error state, empty
 * state, one segment card per API segment (workflow-type x role separation),
 * the CPU/memory proxy notice, and that submitting a goal renders the
 * recommendation section. Chart internals are stubbed (recharts draws
 * nothing at jsdom's 0x0 size); the table is rendered for real so the CI
 * text is asserted end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ParetoFrontierResult, ParetoSegment, SegmentRecommendation } from '../types';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${ns}.${key}:${JSON.stringify(values)}` : `${ns}.${key}`;
    t.has = () => true;
    return t;
  },
}));

const mockUseParetoFrontierData = vi.fn();
vi.mock('../useParetoFrontierData', () => ({
  useParetoFrontierData: () => mockUseParetoFrontierData(),
}));

const mockRecommend = vi.fn();
const mockUseParetoRecommendation = vi.fn();
vi.mock('../useParetoRecommendation', () => ({
  useParetoRecommendation: () => mockUseParetoRecommendation(),
}));

vi.mock('../components/ParetoScatterChart', () => ({
  ParetoScatterChart: ({ points }: { points: unknown[] }) => (
    <div data-testid="pareto-scatter">{points.length}</div>
  ),
}));

import ParetoFrontierPage from '../page';

function estimate(value: number, spread = 1) {
  return { value, ciLow: value - spread, ciHigh: value + spread };
}

function makeSegment(overrides: Partial<ParetoSegment> = {}): ParetoSegment {
  const baseline = {
    sampleSize: 12,
    reliable: true,
    successRate: estimate(90, 8),
    executionTimeMs: estimate(60_000, 5_000),
    costUsd: estimate(0.5, 0.05),
  };
  return {
    workflowType: 'standard',
    role: 'implementer',
    sampleSize: 12,
    baseline,
    points: [
      {
        ...baseline,
        key: 'implementer/claude-sonnet-4-6',
        parameterSet: { role: 'implementer', model: 'claude-sonnet-4-6' },
        successCount: 11,
        avgTokens: 1000,
        paretoOptimal: true,
      },
    ],
    ...overrides,
  };
}

function makeFrontier(segments: ParetoSegment[]): ParetoFrontierResult {
  return {
    windowDays: 30,
    from: '2026-07-29T00:00:00.000Z',
    to: '2026-08-28T00:00:00.000Z',
    totalExecutions: segments.reduce((s, seg) => s + seg.sampleSize, 0),
    filters: { complexityBand: 'all', role: 'all' },
    metrics: {
      resourceAxis: 'costUsd',
      cpuMemoryAvailable: false,
      confidenceLevel: 0.95,
      minReliableSamples: 5,
    },
    segments,
  };
}

function setFrontier(state: {
  frontier: ParetoFrontierResult | null;
  loading: boolean;
  error: string | null;
}) {
  mockUseParetoFrontierData.mockReturnValue({
    ...state,
    filters: { days: 30, complexityBand: 'all', role: 'all' },
    setFilters: vi.fn(),
  });
}

function setRecommendation(result: { recommendations: SegmentRecommendation[] } | null) {
  mockUseParetoRecommendation.mockReturnValue({
    result,
    loading: false,
    error: null,
    recommend: mockRecommend,
    reset: vi.fn(),
  });
}

describe('ParetoFrontierPage', () => {
  beforeEach(() => {
    mockRecommend.mockReset();
    setRecommendation(null);
  });

  it('shows the skeleton while loading', () => {
    setFrontier({ frontier: null, loading: true, error: null });
    const { container } = render(<ParetoFrontierPage />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows the error banner', () => {
    setFrontier({ frontier: null, loading: false, error: 'boom' });
    render(<ParetoFrontierPage />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('shows the empty state when there are no segments', () => {
    setFrontier({ frontier: makeFrontier([]), loading: false, error: null });
    render(<ParetoFrontierPage />);
    expect(screen.getByText('agents.pareto.empty.title')).toBeInTheDocument();
    expect(screen.getByTestId('cpu-memory-notice')).toBeInTheDocument();
  });

  it('renders one card per workflow-type x role segment with CI text in the table', () => {
    setFrontier({
      frontier: makeFrontier([
        makeSegment(),
        makeSegment({ workflowType: 'lightweight', role: 'researcher' }),
      ]),
      loading: false,
      error: null,
    });
    render(<ParetoFrontierPage />);

    expect(screen.getAllByTestId('pareto-segment')).toHaveLength(2);
    expect(screen.getAllByTestId('pareto-scatter')).toHaveLength(2);
    expect(
      screen.getByText(
        'agents.pareto.segment.title:{"workflowType":"agents.pareto.workflowType.lightweight","role":"agents.pareto.roles.researcher"}',
      ),
    ).toBeInTheDocument();
    // Success-rate CI rendered as value [low – high] for the point row.
    expect(screen.getAllByText('90.0 [82.0 – 98.0]%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('agents.pareto.table.optimal')).toHaveLength(2);
  });

  it('submits the goal form and renders the recommendation section', () => {
    setFrontier({ frontier: makeFrontier([makeSegment()]), loading: false, error: null });
    const seg = makeSegment();
    setRecommendation({
      recommendations: [
        {
          workflowType: 'standard',
          role: 'implementer',
          feasible: true,
          reason: 'ok',
          baseline: seg.baseline,
          recommended: seg.points[0],
          bestAlternative: null,
          projection: {
            monthlyVolume: 12,
            deltaCostUsdPerMonth: 3.5,
            deltaTimeMsPerExecution: -2000,
            deltaMonthlyHours: -0.01,
            deltaSuccessRatePoints: 5,
          },
          confidence: 0.6,
        },
      ],
    });
    render(<ParetoFrontierPage />);

    fireEvent.click(screen.getByText('agents.pareto.goal.submit'));
    expect(mockRecommend).toHaveBeenCalledWith({ kind: 'successRate', value: 95 });

    expect(screen.getByTestId('recommendation-section')).toBeInTheDocument();
    expect(screen.getAllByTestId('recommendation-card')).toHaveLength(1);
    expect(screen.getByText('agents.pareto.recommendation.reason.ok')).toBeInTheDocument();
    expect(screen.getByText('+3.50 USD')).toBeInTheDocument();
  });
});
