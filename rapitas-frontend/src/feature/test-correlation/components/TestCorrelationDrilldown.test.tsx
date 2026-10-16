/**
 * TestCorrelationDrilldown.test
 *
 * Verifies failureTail rendering (present / absent / empty) and that the
 * existing commit / source / environment fields keep rendering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TestCorrelationDrilldown } from './TestCorrelationDrilldown';
import type { FailureDrilldownEntry } from '../test-correlation.types';

const fetchMock = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, params?: Record<string, string>) =>
    params ? `${ns}.${key}:${Object.values(params).join('|')}` : `${ns}.${key}`,
}));

vi.mock('../hooks/useTestCorrelationMatrix', () => ({
  fetchTestCorrelationDrilldown: (...args: unknown[]) => fetchMock(...args),
}));

function entry(overrides: Partial<FailureDrilldownEntry> = {}): FailureDrilldownEntry {
  return {
    runId: 'run-1',
    timestamp: '2026-10-01T00:00:00Z',
    commitSha: 'abc1234',
    source: 'ci',
    environment: { platform: 'linux', runtimeVersion: 'bun-1.2' },
    flaky: false,
    ...overrides,
  };
}

async function renderWith(entries: FailureDrilldownEntry[]) {
  fetchMock.mockResolvedValue(entries);
  render(<TestCorrelationDrilldown changedFile="a.ts" testFile="a.test.ts" onClose={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByText('testCorrelation.drilldown.runIdLabel:run-1')).toBeInTheDocument(),
  );
}

describe('TestCorrelationDrilldown failureTail', () => {
  beforeEach(() => fetchMock.mockReset());

  it('renders every failureTail line when recorded', async () => {
    await renderWith([entry({ failureTail: ['FAIL a.test.ts', 'expected 1 got 2'] })]);
    const pre = screen.getByTestId('failure-tail');
    expect(pre.textContent).toBe('FAIL a.test.ts\nexpected 1 got 2');
    expect(screen.queryByText('testCorrelation.drilldown.failureTailEmpty')).toBeNull();
  });

  it('shows the not-recorded message when failureTail is missing', async () => {
    await renderWith([entry()]);
    expect(screen.getByText('testCorrelation.drilldown.failureTailEmpty')).toBeInTheDocument();
    expect(screen.queryByTestId('failure-tail')).toBeNull();
  });

  it('treats an empty failureTail array as not recorded', async () => {
    await renderWith([entry({ failureTail: [] })]);
    expect(screen.getByText('testCorrelation.drilldown.failureTailEmpty')).toBeInTheDocument();
  });

  it('keeps commit, source and environment rows alongside the log', async () => {
    await renderWith([entry({ failureTail: ['boom'] })]);
    expect(screen.getByText('testCorrelation.drilldown.commitLabel:abc1234')).toBeInTheDocument();
    expect(
      screen.getByText('testCorrelation.drilldown.sourceLabel:testCorrelation.drilldown.sourceCi'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('testCorrelation.drilldown.environmentLabel:linux|bun-1.2'),
    ).toBeInTheDocument();
  });
});
