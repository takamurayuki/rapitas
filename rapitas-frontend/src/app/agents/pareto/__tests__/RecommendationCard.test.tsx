/**
 * RecommendationCard.test
 *
 * Verifies the three verdict presentations: feasible (recommended point +
 * projection), unreachable (closest alternative label), and insufficient
 * data (hint, no projection).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecommendationCard } from '../components/RecommendationCard';
import type { ParetoPoint, SegmentRecommendation } from '../types';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${ns}.${key}:${JSON.stringify(values)}` : `${ns}.${key}`;
    t.has = (key: string) => key !== 'custom_role';
    return t;
  },
}));

function estimate(value: number, spread = 1) {
  return { value, ciLow: value - spread, ciHigh: value + spread };
}

const baseline = {
  sampleSize: 20,
  reliable: true,
  successRate: estimate(90, 5),
  executionTimeMs: estimate(60_000, 4_000),
  costUsd: estimate(0.5, 0.05),
};

const point: ParetoPoint = {
  ...baseline,
  sampleSize: 10,
  successRate: estimate(96, 4),
  costUsd: estimate(1.2, 0.1),
  key: 'implementer/claude-opus-4-6',
  parameterSet: { role: 'implementer', model: 'claude-opus-4-6' },
  successCount: 10,
  avgTokens: 0,
  paretoOptimal: true,
};

function makeRec(overrides: Partial<SegmentRecommendation> = {}): SegmentRecommendation {
  return {
    workflowType: 'standard',
    role: 'implementer',
    feasible: true,
    reason: 'ok',
    baseline,
    recommended: point,
    bestAlternative: null,
    projection: {
      monthlyVolume: 20,
      deltaCostUsdPerMonth: 14,
      deltaTimeMsPerExecution: 0,
      deltaMonthlyHours: 0,
      deltaSuccessRatePoints: 6,
    },
    confidence: 0.5,
    ...overrides,
  };
}

describe('RecommendationCard', () => {
  it('renders the recommended point, current mix and projection when feasible', () => {
    render(<RecommendationCard recommendation={makeRec()} />);
    expect(screen.getByText('agents.pareto.recommendation.reason.ok')).toBeInTheDocument();
    expect(screen.getByText('agents.pareto.recommendation.recommended')).toBeInTheDocument();
    expect(screen.getByText('claude-opus-4-6')).toBeInTheDocument();
    // The CI sits in the same text node as its label, so match by substring.
    expect(screen.getByText(/96\.0 \[92\.0 – 100\.0\]%/)).toBeInTheDocument();
    expect(screen.getByText('+14.00 USD')).toBeInTheDocument();
    expect(screen.getByText('+6.0pt')).toBeInTheDocument();
    expect(screen.getByText('agents.pareto.recommendation.confidence: 50%')).toBeInTheDocument();
  });

  it('labels the closest candidate when the goal is unreachable', () => {
    render(
      <RecommendationCard
        recommendation={makeRec({
          feasible: false,
          reason: 'target_unreachable',
          recommended: null,
          bestAlternative: point,
        })}
      />,
    );
    expect(
      screen.getByText('agents.pareto.recommendation.reason.target_unreachable'),
    ).toBeInTheDocument();
    expect(screen.getByText('agents.pareto.recommendation.alternative')).toBeInTheDocument();
  });

  it('shows the insufficient-data hint without a projection and falls back for unknown roles', () => {
    render(
      <RecommendationCard
        recommendation={makeRec({
          role: 'custom_role',
          feasible: false,
          reason: 'insufficient_data',
          recommended: null,
          projection: null,
          confidence: 0,
        })}
      />,
    );
    expect(
      screen.getByText('agents.pareto.recommendation.insufficientHint:{"min":5}'),
    ).toBeInTheDocument();
    expect(screen.queryByText('agents.pareto.recommendation.deltaCost')).toBeNull();
    expect(
      screen.getByText(
        'agents.pareto.segment.title:{"workflowType":"agents.pareto.workflowType.standard","role":"custom_role"}',
      ),
    ).toBeInTheDocument();
  });
});
