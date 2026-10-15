/**
 * page.test
 *
 * Verifies the /agents/failure-lineage page against the acceptance criteria:
 * (1) estimate banner always shown, (2) per-edge confidence, (3) root-cause
 * candidate highlighted, (4) estimated "N fewer downstream events" text,
 * (5) validation result incl. the null "no target" state. Also covers the
 * loading / error / empty states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { FailureLineageData } from '../types';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${ns}.${key}:${JSON.stringify(values)}` : `${ns}.${key}`;
    t.has = () => true;
    return t;
  },
}));

const mockUseFailureLineage = vi.fn();
vi.mock('../useFailureLineage', () => ({
  useFailureLineage: () => mockUseFailureLineage(),
}));

import FailureLineagePage from '../page';

const T0 = Date.UTC(2026, 9, 15);

function makeData(overrides: Partial<FailureLineageData> = {}): FailureLineageData {
  const mk = (n: number, template: string, level: 'ERROR' | 'WARN' = 'ERROR') => ({
    id: `log-${n}`,
    executionId: 1,
    level,
    template,
    templateId: `t${n}`,
    resources: [],
    timestamp: T0 + n * 1000,
    sequenceNumber: n,
    sample: template,
  });
  return {
    nodes: [
      mk(1, 'merge conflict in <BRANCH>'),
      mk(2, 'git push rejected for <BRANCH>'),
      mk(3, 'retry limit reached', 'WARN'),
    ],
    edges: [
      { parentId: 'log-1', childId: 'log-2', confidence: 0.9, basis: 'rule', ruleId: 'r1' },
      { parentId: 'log-2', childId: 'log-3', confidence: 0.5, basis: 'same_execution' },
    ],
    clusters: [],
    rootCauseCandidates: [{ nodeId: 'log-1', estimatedReducedCount: 2 }],
    validation: {
      matchRate: 1,
      knownEdgeCount: 3,
      matched: 3,
      mismatched: 0,
      unchecked: 1,
      liveConfirmed: 1,
      decisionLogMatches: 4,
      chains: [{ chainId: 'c1', label: 'chain-one', expectedEdges: 2, matchedEdges: 2 }],
    },
    truncated: false,
    isEstimated: true,
    windowHours: 24,
    ...overrides,
  };
}

function state(partial: Record<string, unknown>) {
  return {
    data: null,
    loading: false,
    error: null,
    hours: 24,
    setHours: vi.fn(),
    refetch: vi.fn(),
    ...partial,
  };
}

beforeEach(() => {
  mockUseFailureLineage.mockReset();
});

describe('FailureLineagePage', () => {
  it('AC1: shows the estimate banner on every state, including loading', () => {
    mockUseFailureLineage.mockReturnValue(state({ loading: true }));
    render(<FailureLineagePage />);
    expect(screen.getByTestId('estimate-banner').textContent).toBe(
      'agents.failureLineage.estimateBanner',
    );
    expect(screen.getByTestId('lineage-loading')).toBeTruthy();
  });

  it('AC2: renders each edge confidence with two decimals', () => {
    mockUseFailureLineage.mockReturnValue(state({ data: makeData() }));
    render(<FailureLineagePage />);
    const all = within(screen.getByTestId('all-events-section'));
    const texts = all.getAllByTestId('edge-confidence').map((e) => e.textContent ?? '');
    expect(texts.some((t) => t.includes('"confidence":"0.90"'))).toBe(true);
    expect(texts.some((t) => t.includes('"confidence":"0.50"'))).toBe(true);
  });

  it('AC3: highlights the root-cause candidate node (and only it)', () => {
    mockUseFailureLineage.mockReturnValue(state({ data: makeData() }));
    render(<FailureLineagePage />);
    const rows = within(screen.getByTestId('all-events-section')).getAllByTestId('lineage-row');
    expect(rows.map((r) => r.getAttribute('data-candidate'))).toEqual(['true', 'false', 'false']);
    expect(within(rows[0]).getByTestId('candidate-badge')).toBeTruthy();
    expect(within(rows[1]).queryByTestId('candidate-badge')).toBeNull();
  });

  it('AC4: shows the estimated downstream reduction N on the candidate', () => {
    mockUseFailureLineage.mockReturnValue(
      state({
        data: makeData({ rootCauseCandidates: [{ nodeId: 'log-1', estimatedReducedCount: 7 }] }),
      }),
    );
    render(<FailureLineagePage />);
    const el = within(screen.getByTestId('candidate-section')).getByTestId('reduced-estimate');
    expect(el.textContent).toBe('agents.failureLineage.reducedEstimate:{"count":7}');
  });

  it('AC5: shows validation match rate and counts', () => {
    mockUseFailureLineage.mockReturnValue(state({ data: makeData() }));
    render(<FailureLineagePage />);
    expect(screen.getByTestId('validation-match-rate').textContent).toContain('"rate":"100"');
    expect(screen.getByTestId('validation-matched').textContent).toContain('3');
    expect(screen.getByTestId('validation-unchecked').textContent).toContain('1');
    expect(screen.getByTestId('validation-decision-logs').textContent).toContain('4');
  });

  it('AC5: shows "no target" when matchRate is null', () => {
    const base = makeData();
    mockUseFailureLineage.mockReturnValue(
      state({
        data: makeData({
          validation: { ...base.validation, matchRate: null, knownEdgeCount: 0, chains: [] },
        }),
      }),
    );
    render(<FailureLineagePage />);
    expect(screen.getByTestId('validation-none').textContent).toBe(
      'agents.failureLineage.validation.noTarget',
    );
    expect(screen.queryByTestId('validation-match-rate')).toBeNull();
  });

  it('shows the error state with the banner still visible', () => {
    mockUseFailureLineage.mockReturnValue(state({ error: 'boom' }));
    render(<FailureLineagePage />);
    expect(screen.getByTestId('lineage-error').textContent).toContain('boom');
    expect(screen.getByTestId('estimate-banner')).toBeTruthy();
  });

  it('shows the empty state when there are no nodes', () => {
    mockUseFailureLineage.mockReturnValue(
      state({ data: makeData({ nodes: [], edges: [], rootCauseCandidates: [] }) }),
    );
    render(<FailureLineagePage />);
    expect(screen.getByTestId('lineage-empty')).toBeTruthy();
  });

  it('disables refresh while loading', () => {
    mockUseFailureLineage.mockReturnValue(state({ data: makeData(), loading: true }));
    render(<FailureLineagePage />);
    const btn = screen.getByRole('button', { name: /refresh/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
