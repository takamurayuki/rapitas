import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ResourceContentionPanel } from '../ResourceContentionPanel';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

const BASE_STATUS = {
  enabled: true,
  thresholdPercent: 85,
  hostCpuBusyPercent: 42,
  effectiveMaxConcurrency: 4,
};

const BASE_DEFERRAL = {
  themeId: 7,
  cpuBusyPercent: 91,
  thresholdPercent: 85,
  createdAt: '2026-08-29T00:00:00.000Z',
};

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

function routeFetch(
  mockFetch: ReturnType<typeof vi.fn>,
  statusBody: unknown,
  deferralsBody: unknown,
) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/resource-gate/status')) return Promise.resolve(jsonResponse(statusBody));
    if (url.includes('/resource-gate/deferrals'))
      return Promise.resolve(jsonResponse(deferralsBody));
    if (url.includes('/resource-gate/override/')) return Promise.resolve(jsonResponse({}));
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

describe('ResourceContentionPanel', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders nothing before the first response arrives', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(<ResourceContentionPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the enabled badge and current CPU / threshold / concurrency tiles', async () => {
    routeFetch(mockFetch, BASE_STATUS, []);

    render(<ResourceContentionPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('resourceContention.enabled')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows the disabled badge and "unsampled" when CPU has not been sampled', async () => {
    routeFetch(mockFetch, { ...BASE_STATUS, enabled: false, hostCpuBusyPercent: null }, []);

    render(<ResourceContentionPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('resourceContention.disabled')).toBeInTheDocument();
    expect(screen.getByText('resourceContention.unsampled')).toBeInTheDocument();
  });

  it('renders the empty state when there are no deferrals', async () => {
    routeFetch(mockFetch, BASE_STATUS, []);

    render(<ResourceContentionPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('resourceContention.empty')).toBeInTheDocument();
  });

  it('renders one row per deferral with a run-now button for its theme', async () => {
    routeFetch(mockFetch, BASE_STATUS, [BASE_DEFERRAL]);

    render(<ResourceContentionPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('resourceContention.runNow')).toBeInTheDocument();
  });

  it('posts an override and re-polls when "run now" is clicked', async () => {
    routeFetch(mockFetch, BASE_STATUS, [BASE_DEFERRAL]);

    render(<ResourceContentionPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callsBefore = mockFetch.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByText('resourceContention.runNow'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test:3001/agents/resource-gate/override/7',
      expect.objectContaining({ method: 'POST' }),
    );
    // override() re-polls status + deferrals afterwards
    expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore + 1);
  });

  it('shows the load-failed message when the status fetch rejects', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    render(<ResourceContentionPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('resourceContention.loadFailed')).toBeInTheDocument();
  });
});
