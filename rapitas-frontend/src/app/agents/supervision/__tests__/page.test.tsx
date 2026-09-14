/**
 * AgentSupervisionPage.test
 *
 * The page renders unmet reasons and denominators, and never shows "met" when
 * the status could not be loaded.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UseSupervisionAcceptanceReturn } from '../_hooks/useSupervisionAcceptance';

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key;
    t.has = (key: string) => key !== 'reasons.unknown_future_code';
    return t;
  },
}));

let hookValue: UseSupervisionAcceptanceReturn;
vi.mock('../_hooks/useSupervisionAcceptance', () => ({
  useSupervisionAcceptance: () => hookValue,
}));

import AgentSupervisionPage from '../page';

const STATUS = {
  met: false,
  streakCount: 3,
  streakStartAt: null,
  hoursSinceLastIntervention: 5.5,
  observedGapMinutes: 12,
  reasonCodes: ['snapshot_stale', 'unknown_future_code'],
  blockingTaskIds: [895],
  evalSetVersion: null,
  denominators: { requiredTasks: 10, requiredHours: 24 },
  snapshotAt: null,
  snapshotAgeMinutes: 20,
  heartbeatCount: 5,
  lastHeartbeatAt: null,
  heartbeatAgeSeconds: 30,
};

describe('AgentSupervisionPage', () => {
  it('lists every unmet reason, including codes without a translation', () => {
    hookValue = { status: STATUS, loading: false, error: false };
    render(<AgentSupervisionPage />);
    expect(screen.getByTestId('supervision-verdict').textContent).toBe('notMet');
    const reasons = screen.getByTestId('supervision-reasons').textContent ?? '';
    expect(reasons).toContain('reasons.snapshot_stale');
    expect(reasons).toContain('unknown_future_code');
    expect(screen.getByText('#895')).toBeTruthy();
  });

  it('shows not met with an alert when loading failed, even over a previous met status', () => {
    hookValue = { status: { ...STATUS, met: true, reasonCodes: [] }, loading: false, error: true };
    render(<AgentSupervisionPage />);
    expect(screen.getAllByTestId('supervision-verdict').at(-1)?.textContent).toBe('notMet');
    expect(screen.getByRole('alert').textContent).toBe('loadFailed');
  });
});
