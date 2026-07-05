/**
 * AgentUsageBreakdownWidget tests
 *
 * Verifies fetch wiring (days param), the per-role table rendered from real
 * API-shaped data, the empty state, and the error state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AgentUsageBreakdownWidget from './AgentUsageBreakdownWidget';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

// NOTE: recharts ResponsiveContainer measures the DOM, which jsdom cannot do;
// stub the chart primitives so the test focuses on data wiring and the table.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: ({ dataKey }: { dataKey: string }) => <div data-testid={`bar-${dataKey}`} />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const breakdown = {
  windowDays: 14,
  totalCostUsd: 100.5,
  totalExecutions: 42,
  roles: [
    {
      role: 'implementer',
      executions: 30,
      failedExecutions: 5,
      costUsd: 80.25,
      shareOfCost: 0.7985,
      inputTokens: 1000,
      outputTokens: 250000,
      cacheReadInputTokens: 9000,
      cacheCreationInputTokens: 100,
      llmCalls: 90,
      cacheHitRate: 0.9,
      averageExecutionTimeMs: 1200,
    },
    {
      role: 'verifier',
      executions: 12,
      failedExecutions: 0,
      costUsd: 20.25,
      shareOfCost: 0.2015,
      inputTokens: 500,
      outputTokens: 50000,
      cacheReadInputTokens: 4500,
      cacheCreationInputTokens: 50,
      llmCalls: 30,
      cacheHitRate: 0.9,
      averageExecutionTimeMs: 900,
    },
  ],
  dailyRoleCost: [
    { date: '2026-07-01', totalCostUsd: 60, byRole: { implementer: 50, verifier: 10 } },
    { date: '2026-07-02', totalCostUsd: 40.5, byRole: { implementer: 30.25, verifier: 10.25 } },
  ],
};

describe('AgentUsageBreakdownWidget', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the default 14-day window and renders per-role rows', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => breakdown });

    render(<AgentUsageBreakdownWidget />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:3001/agent-metrics/usage-breakdown?days=14',
      ),
    );

    expect(await screen.findByText('agentUsage.roles.implementer')).toBeInTheDocument();
    expect(screen.getByText('agentUsage.roles.verifier')).toBeInTheDocument();
    // Cost with share, failures, and one stacked series per role with cost.
    expect(screen.getByText('$80.25')).toBeInTheDocument();
    expect(screen.getByText('(80%)')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByTestId('bar-implementer')).toBeInTheDocument();
    expect(screen.getByTestId('bar-verifier')).toBeInTheDocument();
  });

  it('refetches when the window selector changes', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => breakdown });

    render(<AgentUsageBreakdownWidget />);
    await screen.findByText('agentUsage.roles.implementer');

    fireEvent.click(screen.getByText('agentUsage.daysButton:{"days":30}'));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:3001/agent-metrics/usage-breakdown?days=30',
      ),
    );
  });

  it('shows the empty state when there are no executions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...breakdown, totalExecutions: 0, roles: [], dailyRoleCost: [] }),
    });

    render(<AgentUsageBreakdownWidget />);
    expect(await screen.findByText('agentUsage.noData')).toBeInTheDocument();
  });

  it('shows an error message when the request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    render(<AgentUsageBreakdownWidget />);
    expect(await screen.findByText('HTTP 500')).toBeInTheDocument();
  });
});
