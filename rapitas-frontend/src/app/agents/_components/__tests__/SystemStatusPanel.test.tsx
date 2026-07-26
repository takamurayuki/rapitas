import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SystemStatusPanel } from '../SystemStatusPanel';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

describe('SystemStatusPanel', () => {
  const mockFetch = vi.fn();

  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    setHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders nothing before the first /health response arrives', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(<SystemStatusPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a healthy pill and the tile values from /health', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        status: 'healthy',
        uptimeSeconds: 3725,
        activeExecutions: 0,
        runningExecutions: 2,
        interruptedExecutions: 0,
        queueDepth: 3,
        activePreviewCount: 1,
      }),
    });

    render(<SystemStatusPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockFetch).toHaveBeenCalledWith('http://test:3001/health');
    expect(screen.getByText('systemStatus.pill.healthy')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // running
    expect(screen.getByText('3')).toBeInTheDocument(); // queue depth
    expect(screen.getByText('1')).toBeInTheDocument(); // active preview sessions
    expect(screen.getByText('1h 2m')).toBeInTheDocument(); // uptime
  });

  it('derives a busy pill when executions are actively running', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        status: 'healthy',
        uptimeSeconds: 10,
        activeExecutions: 1,
        runningExecutions: 1,
        interruptedExecutions: 0,
        queueDepth: 0,
      }),
    });

    render(<SystemStatusPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('systemStatus.pill.busy')).toBeInTheDocument();
  });

  it('derives an interrupted pill when interruptedExecutions > 0', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        status: 'healthy',
        uptimeSeconds: 10,
        activeExecutions: 0,
        runningExecutions: 0,
        interruptedExecutions: 2,
        queueDepth: 0,
      }),
    });

    render(<SystemStatusPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('systemStatus.pill.interrupted')).toBeInTheDocument();
  });

  it('shows an unhealthy pill when the fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));

    render(<SystemStatusPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('systemStatus.pill.unhealthy')).toBeInTheDocument();
  });

  it('re-polls every 10s but skips the request while the tab is hidden', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        status: 'healthy',
        uptimeSeconds: 10,
        activeExecutions: 0,
        runningExecutions: 0,
        interruptedExecutions: 0,
        queueDepth: 0,
      }),
    });

    render(<SystemStatusPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    setHidden(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    setHidden(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('cleans up the polling interval on unmount', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        status: 'healthy',
        uptimeSeconds: 10,
        activeExecutions: 0,
        runningExecutions: 0,
        interruptedExecutions: 0,
        queueDepth: 0,
      }),
    });

    const { unmount } = render(<SystemStatusPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
