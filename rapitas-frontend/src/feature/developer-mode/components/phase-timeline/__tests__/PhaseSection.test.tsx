/**
 * PhaseSection tests
 *
 * Verifies task #785's core section behaviors: a completed iteration
 * collapses to its 1-line summary, a running iteration auto-expands and
 * shows its live log, and the "⚠のみ" filter narrows entries to
 * warning/error rows.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { PhaseSection } from '../PhaseSection';
import type { PhaseIteration } from '../../../hooks/usePhaseTimeline';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

function iteration(overrides: Partial<PhaseIteration>): PhaseIteration {
  return {
    iterationNumber: 1,
    executionIds: [1],
    startedAt: '2026-08-30T00:00:00.000Z',
    completedAt: '2026-08-30T00:01:23.000Z',
    status: 'completed',
    logLineCount: 2,
    boundaryUncertain: false,
    summary: {
      status: 'completed',
      durationMs: 83000,
      logLineCount: 2,
      testPass: null,
      testFail: null,
    },
    ...overrides,
  };
}

describe('PhaseSection', () => {
  it('collapses a completed iteration and shows its 1-line summary', () => {
    render(
      <PhaseSection
        phaseType="research"
        iteration={iteration({})}
        totalIterationsForPhase={1}
        filterWarnOnly={false}
        liveLogLines={null}
      />,
    );

    const header = screen.getByRole('button');
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/summary\.completed/)).toBeInTheDocument();
  });

  it('auto-expands a running iteration and renders its live log', () => {
    render(
      <PhaseSection
        phaseType="implement"
        iteration={iteration({
          status: 'running',
          completedAt: null,
          summary: {
            status: 'running',
            durationMs: null,
            logLineCount: 1,
            testPass: null,
            testFail: null,
          },
        })}
        totalIterationsForPhase={1}
        filterWarnOnly={false}
        liveLogLines={['[INFO] doing work']}
      />,
    );

    const header = screen.getByRole('button');
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/doing work/)).toBeInTheDocument();
  });

  it('narrows entries to warning/error rows when filterWarnOnly is set', () => {
    render(
      <PhaseSection
        phaseType="implement"
        iteration={iteration({ status: 'running', completedAt: null })}
        totalIterationsForPhase={1}
        filterWarnOnly
        liveLogLines={['just a normal status update line', 'error: something broke']}
      />,
    );

    expect(screen.queryByText(/normal status update/)).not.toBeInTheDocument();
    expect(screen.getByText('エラーが発生しました')).toBeInTheDocument();
  });

  it('toggles expansion when the header is clicked', () => {
    render(
      <PhaseSection
        phaseType="verify"
        iteration={iteration({})}
        totalIterationsForPhase={1}
        filterWarnOnly={false}
        liveLogLines={null}
      />,
    );

    const header = screen.getByRole('button');
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the "(N回目)" iteration suffix title when this phase has repeated', () => {
    render(
      <PhaseSection
        phaseType="implement"
        iteration={iteration({ iterationNumber: 2 })}
        totalIterationsForPhase={2}
        filterWarnOnly={false}
        liveLogLines={null}
      />,
    );

    expect(screen.getByText(/sectionTitleIteration/)).toBeInTheDocument();
  });
});
