/**
 * CalendarSlotsClient.test
 *
 * AC6 (task 1174): the calendar-slot dashboard lists the next run schedule,
 * the execution log and the sync state, including the empty, error and
 * stale / failed-sync states.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CalendarSlotsClient from './CalendarSlotsClient';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

const NEXT_RUNS = {
  enabled: true,
  leadMinutes: 10,
  nextRunAt: '2026-10-12T11:00:00.000Z',
  gate: { hold: true, reason: 'pre_meeting', releaseAt: '2026-10-12T11:00:00.000Z' },
  freeSlots: [{ startAt: '2026-10-12T11:00:00.000Z', endAt: '2026-10-12T12:00:00.000Z' }],
  busyBlocks: [{ startAt: '2026-10-12T10:00:00.000Z', endAt: '2026-10-12T11:00:00.000Z' }],
  holds: [{ themeId: 3, releaseAt: '2026-10-12T11:00:00.000Z' }],
};

const SYNC_OK = {
  enabled: true,
  connected: true,
  pollMinutes: 5,
  lastSyncedAt: '2026-10-12T09:55:00.000Z',
  lastStatus: 'ok',
  lastError: null,
  stale: false,
};

const LOGS = {
  total: 1,
  items: [
    {
      id: 9,
      action: 'calendar_slot.hold_started',
      metadata: { themeId: 3, reason: 'pre_meeting' },
      createdAt: '2026-10-12T09:50:00.000Z',
    },
  ],
};

function respond(payloads: { nextRuns?: unknown; sync?: unknown; logs?: unknown }) {
  return (url: string) => {
    const body = url.includes('/next-runs')
      ? payloads.nextRuns
      : url.includes('/sync-state')
        ? payloads.sync
        : payloads.logs;
    return Promise.resolve({ ok: true, json: async () => body });
  };
}

describe('CalendarSlotsClient', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists the next run, held themes, free slots and the execution log', async () => {
    mockFetch.mockImplementation(respond({ nextRuns: NEXT_RUNS, sync: SYNC_OK, logs: LOGS }));
    render(<CalendarSlotsClient />);

    await waitFor(() => expect(screen.getByTestId('next-run-at')).toBeInTheDocument());
    expect(screen.getByText('gateHeld')).toBeInTheDocument();
    expect(screen.getByTestId('held-theme-3')).toBeInTheDocument();
    expect(screen.getAllByTestId('free-slot')).toHaveLength(1);
    expect(screen.getByText('action.hold_started')).toBeInTheDocument();
    expect(screen.getByText('syncOk')).toBeInTheDocument();
    expect(screen.getByText('runningPhaseNote')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith('http://test:3001/calendar-slots/logs?page=1&limit=10');
  });

  it('shows the empty log state and the connect action when not connected', async () => {
    mockFetch.mockImplementation(
      respond({
        nextRuns: {
          ...NEXT_RUNS,
          gate: { hold: false, reason: 'free', releaseAt: null },
          holds: [],
        },
        sync: {
          ...SYNC_OK,
          connected: false,
          lastSyncedAt: null,
          lastStatus: 'never',
          stale: true,
        },
        logs: { total: 0, items: [] },
      }),
    );
    render(<CalendarSlotsClient />);

    await waitFor(() => expect(screen.getByText('logsEmpty')).toBeInTheDocument());
    expect(screen.getByText('connect')).toBeInTheDocument();
    expect(screen.getByText('gateFree')).toBeInTheDocument();
  });

  it('surfaces a failed / stale sync with its error text', async () => {
    mockFetch.mockImplementation(
      respond({
        nextRuns: NEXT_RUNS,
        sync: { ...SYNC_OK, lastStatus: 'error', lastError: 'invalid_grant', stale: true },
        logs: LOGS,
      }),
    );
    render(<CalendarSlotsClient />);

    await waitFor(() => expect(screen.getByText('syncError')).toBeInTheDocument());
    expect(screen.getByText('invalid_grant')).toBeInTheDocument();
    expect(screen.getByText('stale')).toBeInTheDocument();
  });

  it('lists phase-boundary holds of running tasks with their checkpoint', async () => {
    mockFetch.mockImplementation(
      respond({
        nextRuns: NEXT_RUNS,
        sync: SYNC_OK,
        logs: {
          total: 1,
          items: [
            {
              id: 10,
              action: 'calendar_slot.phase_held',
              metadata: { taskId: 7, checkpoint: 'plan_approved', reason: 'pre_meeting' },
              createdAt: '2026-10-12T09:51:00.000Z',
            },
          ],
        },
      }),
    );
    render(<CalendarSlotsClient />);

    await waitFor(() => expect(screen.getByText('action.phase_held')).toBeInTheDocument());
    expect(screen.getByText(/taskId=7/)).toBeInTheDocument();
    expect(screen.getByText(/checkpoint=plan_approved/)).toBeInTheDocument();
  });

  it('shows the load error when the API is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    render(<CalendarSlotsClient />);

    await waitFor(() => expect(screen.getByText('loadFailed')).toBeInTheDocument());
  });
});
