/**
 * PhaseTimeline tests
 *
 * Verifies task #785's top-level contract: the newly-added implement phase
 * renders as a section (no separate phase rail/tabs — the operator-approved
 * design explicitly rejected those), and a task with no phase data falls
 * back to the flat log list instead of rendering nothing.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { PhaseTimeline } from '../PhaseTimeline';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const mockFetch = vi.fn();

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

function iterationFixture(overrides: Record<string, unknown> = {}) {
  return {
    iterationNumber: 1,
    executionIds: [1],
    startedAt: '2026-08-30T00:00:00.000Z',
    completedAt: '2026-08-30T00:01:00.000Z',
    status: 'completed',
    logLineCount: 5,
    boundaryUncertain: false,
    summary: {
      status: 'completed',
      durationMs: 60000,
      logLineCount: 5,
      testPass: null,
      testFail: null,
    },
    ...overrides,
  };
}

describe('PhaseTimeline', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders phase TABS and auto-selects the running phase (#796 tab redesign)', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        success: true,
        workflowMode: 'standard',
        phases: [
          { phaseType: 'research', iterations: [iterationFixture()] },
          { phaseType: 'implement', iterations: [iterationFixture()] },
          {
            phaseType: 'verify',
            iterations: [iterationFixture({ status: 'running', completedAt: null })],
          },
        ],
      }),
    );

    render(<PhaseTimeline taskId={785} isRunning liveLogs={[]} />);

    await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));

    // Tab strip exists with one tab per phase; the running phase (verify) is selected.
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /phaseLabel\.implement/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /phaseLabel\.verify/ })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
  });

  it('falls back to the flat log list when the task has no phase data', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({ success: true, workflowMode: 'standard', phases: [] }),
    );

    render(
      <PhaseTimeline taskId={999} isRunning={false} liveLogs={['just a normal status line']} />,
    );

    await waitFor(() => expect(screen.getByText(/normal status line/)).toBeInTheDocument());
  });
});
