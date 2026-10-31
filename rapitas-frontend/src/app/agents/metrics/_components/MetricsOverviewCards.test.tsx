/**
 * MetricsOverviewCards.test
 *
 * The headline KPI read "成功率 95.57%" from the share of CLI processes that
 * exited 0, while 36-53% of the tasks completed in those same weeks had needed
 * a verify_repair. The big number now carries the task-level first-pass rate,
 * and the exit-0 rate keeps a line under it named for what it measures (#1300).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricsOverviewCards } from './MetricsOverviewCards';
import type { MetricsOverview } from '../_hooks/useMetricsData';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

function overview(patch: Partial<MetricsOverview> = {}): MetricsOverview {
  return {
    totalExecutions: 655,
    totalSuccessful: 626,
    totalFailed: 17,
    totalUnfinished: 12,
    overallSuccessRate: 97.36,
    // Equals the tokenBreakdown sum below — the backend totals the same four
    // columns, so the headline can never disagree with the parts beside it.
    totalTokensUsed: 294_210_264,
    totalAgents: 8,
    activeAgents: 5,
    averageExecutionTime: 176_297,
    firstPassCompletion: { completedTasks: 25, repairFreeTasks: 16, rate: 0.64 },
    // The live October shape: cache reads are 94.78% of the volume at about a
    // tenth the price of a fresh input token (#1302).
    tokenBreakdown: {
      input: 3_752,
      output: 2_001_466,
      cacheRead: 278_844_586,
      cacheCreation: 13_360_460,
    },
    ...patch,
  };
}

/** The card's headline figures, in render order. */
const headlineValues = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.text-xl')).map((el) => el.textContent);

/** The first-pass figure's own element — the second headline in the bar. */
const firstPassFigure = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.text-xl'))[1] as HTMLElement;

describe('the quality card', () => {
  it('gives the big number to the first-pass rate, not the exit-0 rate', () => {
    const { container } = render(<MetricsOverviewCards overview={overview()} />);

    const values = headlineValues(container);
    expect(values).toContain('64.0%');
    // The old headline. 97.36% must not be the figure the eye lands on.
    expect(values.join(' ')).not.toContain('97.4');
  });

  it('says how many tasks the rate is based on', () => {
    render(<MetricsOverviewCards overview={overview()} />);
    expect(screen.getByText(/firstPassCompletionSample:\{"count":25\}/)).toBeTruthy();
  });

  it('still shows the exit-0 rate, under a name that does not claim quality', () => {
    render(<MetricsOverviewCards overview={overview()} />);
    expect(screen.getByText(/executionCompletionRate:\{"rate":"97.4"\}/)).toBeTruthy();
    // "成功率" is the label that overstated it; it is not on this card any more.
    expect(screen.queryByText('successRate')).toBeNull();
  });

  it('states the rate plainly once the sample is big enough', () => {
    const { container } = render(
      <MetricsOverviewCards
        overview={overview({
          firstPassCompletion: { completedTasks: 12, repairFreeTasks: 9, rate: 0.75 },
        })}
      />,
    );

    expect(firstPassFigure(container).className).toContain('text-zinc-900');
    expect(screen.queryByText(/lowSample/)).toBeNull();
  });

  // A trailing week often completes 2 or 3 tasks, and "100.0%" off 2 tasks is
  // the same false verdict as the 95.57% this card replaced. The figure stays
  // visible — it is the claim that is withdrawn. Threshold is 12: this repo's
  // own determinism audit found conclusions flipping below that.
  it('withdraws the claim, but not the number, on a thin sample', () => {
    const { container } = render(
      <MetricsOverviewCards
        overview={overview({
          firstPassCompletion: { completedTasks: 2, repairFreeTasks: 2, rate: 1 },
        })}
      />,
    );

    const figure = firstPassFigure(container);
    expect(figure.textContent).toBe('100.0%');
    expect(figure.className).not.toContain('text-zinc-900');
    expect(screen.getByText(/firstPassCompletionLowSample/)).toBeTruthy();
    expect(screen.getByText(/firstPassCompletionSample:\{"count":2\}/)).toBeTruthy();
  });

  // An empty denominator is "no data". A 0% would read as "every task needed a
  // repair", which is the same kind of false verdict the card is fixing.
  it('shows a dash, not 0%, when no task completed in the window', () => {
    const { container } = render(
      <MetricsOverviewCards
        overview={overview({
          firstPassCompletion: { completedTasks: 0, repairFreeTasks: 0, rate: null },
        })}
      />,
    );

    expect(headlineValues(container)).toContain('—');
    expect(screen.getByText(/firstPassCompletionEmpty/)).toBeTruthy();
  });

  // A page open across a deploy gets its next answer from whichever build is
  // up; a missing field must not take the whole metrics page down.
  it('survives an answer with no first-pass figure at all', () => {
    const stale = overview();
    delete (stale as Partial<MetricsOverview>).firstPassCompletion;

    const { container } = render(<MetricsOverviewCards overview={stale} />);

    expect(headlineValues(container)).toContain('—');
  });
});

// One summed "total tokens" said nothing: it mixed four classes whose prices
// differ by ~10x, and on this machine 94.78% of it is cache reads. The card now
// says what the volume is made of (#1302).
describe('the token card', () => {
  it('names the share of each class that matters', () => {
    render(<MetricsOverviewCards overview={overview()} />);
    expect(screen.getByText(/tokenMix:\{"cache":"94.8","output":"0.7"\}/)).toBeTruthy();
  });

  it('reads the total in millions rather than six digits of thousands', () => {
    const { container } = render(<MetricsOverviewCards overview={overview()} />);
    const values = Array.from(container.querySelectorAll('.text-xl')).map((el) => el.textContent);
    expect(values).toContain('294.2M');
    // "758399K" was the old render: six digits plus a unit nobody can scan.
    expect(values.join(' ')).not.toContain('K');
  });

  // Rows predating the per-class columns report only a total, and a 0/0 mix
  // must not render as NaN%.
  it('omits the mix when no class was recorded', () => {
    render(
      <MetricsOverviewCards
        overview={overview({
          tokenBreakdown: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        })}
      />,
    );
    expect(screen.queryByText(/tokenMix/)).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});

describe('the rest of the bar', () => {
  it('keeps the execution and agent counts', () => {
    render(<MetricsOverviewCards overview={overview()} />);
    expect(screen.getByText('655')).toBeTruthy();
    expect(screen.getByText(/5 \/ 8/)).toBeTruthy();
  });
});
