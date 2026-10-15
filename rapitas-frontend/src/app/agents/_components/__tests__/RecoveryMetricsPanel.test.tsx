import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RecoveryMetricsPanel } from '../RecoveryMetricsPanel';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

const BASE_METRIC = {
  errorType: 'quota',
  strategy: 'reroute',
  attempts: 10,
  successes: 6,
  failures: 4,
  noCandidates: 0,
  successRate: 0.6,
  avgLatencyMs: 12_300,
  avgCostUsd: 0.1234,
  failureReasons: { rate_limit: 3, quota: 1 },
  lowSample: false,
};

function mockResponse(metrics: unknown[]) {
  return {
    ok: true,
    json: async () => ({ metrics, windowDays: 45, minSamples: 8, generatedAtMs: 1 }),
  };
}

describe('RecoveryMetricsPanel', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing before the first response arrives', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(<RecoveryMetricsPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the empty state when no attempts are recorded', async () => {
    mockFetch.mockResolvedValue(mockResponse([]));

    render(<RecoveryMetricsPanel />);

    await waitFor(() => expect(screen.getByText('recoveryMetrics.empty')).toBeInTheDocument());
    expect(mockFetch).toHaveBeenCalledWith('http://test:3001/agents/recovery-metrics');
  });

  it('renders one row per metric with formatted rate / latency / cost', async () => {
    mockFetch.mockResolvedValue(mockResponse([BASE_METRIC]));

    render(<RecoveryMetricsPanel />);

    await waitFor(() => expect(screen.getByText('quota')).toBeInTheDocument());
    expect(screen.getByText('reroute')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('12.3s')).toBeInTheDocument();
    expect(screen.getByText('$0.1234')).toBeInTheDocument();
    expect(screen.getByText('rate_limit×3, quota×1')).toBeInTheDocument();
    expect(screen.queryByText('recoveryMetrics.lowSample')).not.toBeInTheDocument();
  });

  it('flags low-sample rows and renders "—" for an all-null cost', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([
        {
          ...BASE_METRIC,
          errorType: 'transient',
          attempts: 2,
          avgCostUsd: null,
          failureReasons: {},
          lowSample: true,
        },
      ]),
    );

    render(<RecoveryMetricsPanel />);

    await waitFor(() => expect(screen.getByText('recoveryMetrics.lowSample')).toBeInTheDocument());
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2); // cost + failure reasons
  });

  it('shows the load-failed message when the fetch rejects', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    render(<RecoveryMetricsPanel />);

    await waitFor(() => expect(screen.getByText('recoveryMetrics.loadFailed')).toBeInTheDocument());
  });
});
