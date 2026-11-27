import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { ResourceContentionPanel } from '../ResourceContentionPanel';

vi.mock('next-intl', () => ({
  // Values are appended so tests can see what a message was formatted with.
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values
      ? `${key} ${Object.entries(values)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(',')}`
      : key,
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

type AgentsFragment = { agents: { resourceContention: { rapitasCpuNote: string } } };

/** Reads the real message fragment for a locale. */
function fragment(locale: 'ja' | 'en'): AgentsFragment {
  const file = path.join(process.cwd(), 'messages', 'fragments', locale, '14-agents.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as AgentsFragment;
}

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

  it('shows rapitas CPU (the gate basis) in the tile and host CPU only as reference (task 1553)', async () => {
    routeFetch(
      mockFetch,
      { ...BASE_STATUS, hostCpuBusyPercent: 97, rapitasCpuBusyPercent: 33, windowMs: 300000 },
      [],
    );

    render(<ResourceContentionPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.getByTestId('resource-gate-host-cpu')).toHaveTextContent('97%');
  });

  it('explains that the gate uses rapitas processes averaged over the window (task 1553 R5)', async () => {
    routeFetch(mockFetch, { ...BASE_STATUS, rapitasCpuBusyPercent: 33, windowMs: 300000 }, []);

    render(<ResourceContentionPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('resourceContention.rapitasCpuNote minutes=5')).toBeInTheDocument();
  });

  it('falls back to a 5-minute window when the backend sends no windowMs', async () => {
    routeFetch(mockFetch, { ...BASE_STATUS, rapitasCpuBusyPercent: 33 }, []);

    render(<ResourceContentionPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('resourceContention.rapitasCpuNote minutes=5')).toBeInTheDocument();
  });

  it('the ja/en messages describe the rapitas-only basis with the window in minutes', () => {
    const ja = fragment('ja').agents.resourceContention.rapitasCpuNote;
    const en = fragment('en').agents.resourceContention.rapitasCpuNote;
    expect(ja).toContain('{minutes} 分');
    expect(ja).toContain('rapitas');
    expect(en).toContain('{minutes}');
  });

  it('shows "unsampled" when rapitas CPU is not sampled yet even if the host value exists', async () => {
    routeFetch(
      mockFetch,
      { ...BASE_STATUS, hostCpuBusyPercent: 97, rapitasCpuBusyPercent: null },
      [],
    );

    render(<ResourceContentionPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('resourceContention.unsampled')).toBeInTheDocument();
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
