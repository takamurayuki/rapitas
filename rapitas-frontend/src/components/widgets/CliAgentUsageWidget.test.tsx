/**
 * CliAgentUsageWidget tests
 *
 * Verifies fetch wiring, yen-converted per-CLI-agent cards from API-shaped
 * data, the share percentages, the empty state, and the error state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CliAgentUsageWidget from './CliAgentUsageWidget';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

const breakdown = {
  windowDays: 14,
  totalCostUsd: 10,
  totalExecutions: 12,
  usdJpyRate: 150,
  agents: [
    {
      agent: 'claude-code',
      executions: 10,
      failedExecutions: 1,
      costUsd: 8,
      shareOfCost: 0.8,
      inputTokens: 100,
      outputTokens: 20000,
      cacheReadInputTokens: 5000,
      llmCalls: 30,
      averageExecutionTimeMs: 1000,
    },
    {
      agent: 'codex',
      executions: 2,
      failedExecutions: 0,
      costUsd: 2,
      shareOfCost: 0.2,
      inputTokens: 50,
      outputTokens: 5000,
      cacheReadInputTokens: 1000,
      llmCalls: 5,
      averageExecutionTimeMs: 800,
    },
  ],
};

describe('CliAgentUsageWidget', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders yen-converted per-agent cards with share percentages', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => breakdown });

    render(<CliAgentUsageWidget />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:3001/agent-metrics/usage-breakdown?days=14',
      ),
    );

    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    // 8 USD × 150 = ¥1,200 / total 10 USD → ¥1,500 in the header.
    expect(screen.getByText(`¥${(1200).toLocaleString('ja-JP')}`)).toBeInTheDocument();
    expect(screen.getByText(`¥${(1500).toLocaleString('ja-JP')}`)).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
  });

  it('shows the empty state when no agents have executions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...breakdown, totalExecutions: 0, agents: [] }),
    });

    render(<CliAgentUsageWidget />);
    expect(await screen.findByText('cliUsage.noData')).toBeInTheDocument();
  });

  it('shows an error message when the request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    render(<CliAgentUsageWidget />);
    expect(await screen.findByText('HTTP 500')).toBeInTheDocument();
  });
});
