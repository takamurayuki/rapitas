import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProbeMetricsPanel } from '../ProbeMetricsPanel';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

const BASE_METRIC = {
  targetId: 'db',
  attempts: 10,
  successes: 8,
  transientRetries: 1,
  permanentFailures: 1,
  successRate: 0.8,
  avgLatencyMs: 850,
  lowSample: false,
};

function mockResponse(metrics: unknown[]) {
  return {
    ok: true,
    json: async () => ({ metrics, windowDays: 45, minSamples: 8, generatedAtMs: 1 }),
  };
}

describe('ProbeMetricsPanel', () => {
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
    const { container } = render(<ProbeMetricsPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the empty state when no attempts are recorded', async () => {
    mockFetch.mockResolvedValue(mockResponse([]));

    render(<ProbeMetricsPanel />);

    await waitFor(() => expect(screen.getByText('probeMetrics.empty')).toBeInTheDocument());
    expect(mockFetch).toHaveBeenCalledWith('http://test:3001/agents/probe-metrics');
  });

  it('renders one row per metric with formatted rate / latency', async () => {
    mockFetch.mockResolvedValue(mockResponse([BASE_METRIC]));

    render(<ProbeMetricsPanel />);

    await waitFor(() => expect(screen.getByText('db')).toBeInTheDocument());
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('850ms')).toBeInTheDocument();
    expect(screen.queryByText('probeMetrics.lowSample')).not.toBeInTheDocument();
  });

  it('flags low-sample rows', async () => {
    mockFetch.mockResolvedValue(
      mockResponse([{ ...BASE_METRIC, targetId: 'agent-endpoint', attempts: 2, lowSample: true }]),
    );

    render(<ProbeMetricsPanel />);

    await waitFor(() => expect(screen.getByText('probeMetrics.lowSample')).toBeInTheDocument());
  });

  it('shows the load-failed message when the fetch rejects', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    render(<ProbeMetricsPanel />);

    await waitFor(() => expect(screen.getByText('probeMetrics.loadFailed')).toBeInTheDocument());
  });
});
