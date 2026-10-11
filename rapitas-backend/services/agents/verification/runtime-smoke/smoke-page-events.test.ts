/**
 * smoke-page-events.test
 *
 * Closing a page cancels whatever it had in flight, and Chromium reports each
 * cancellation as a `requestfailed` with net::ERR_ABORTED. Counting those made
 * the runtime gate flaky: measured 2026-10-11, task 1195 was blocked by
 * `runtime=NG(5)` whose only finding was
 * `GET /__rapitas_api/schedules/reminders/pending: net::ERR_ABORTED` while `/`
 * had returned HTTP 200 — and the SAME code passed on the next run. Task 1171
 * hit it too; roughly one run in five of the ones sampled that day.
 *
 * The gate is NOT relaxed: an abort during the run is still the page's own
 * behaviour and is still reported. Only the ones the teardown caused are
 * dropped, which is the distinction the module exists to make.
 */

import { describe, expect, test } from 'bun:test';
import {
  createPageEvents,
  recordRequestFailure,
  snapshotPageEvents,
  MAX_FAILED_REQUESTS,
} from './smoke-page-events.mjs';

const ABORTED = 'net::ERR_ABORTED';

/** A failed request as the worker reports one. */
const failure = (overrides: Record<string, unknown> = {}) => ({
  label: 'GET http://127.0.0.1:1/__rapitas_api/schedules/reminders/pending',
  errorText: ABORTED,
  wasPending: true,
  ...overrides,
});

describe('recordRequestFailure', () => {
  test('records a failure the page caused during the run', () => {
    const events = createPageEvents();
    expect(
      recordRequestFailure(events, failure({ errorText: 'net::ERR_CONNECTION_REFUSED' })),
    ).toBe(true);
    expect(events.failedRequests).toHaveLength(1);
    expect(events.failedRequests[0]).toContain('net::ERR_CONNECTION_REFUSED');
  });

  test('records an abort that happens DURING the run', () => {
    // The page cancelling its own request is still the page's behaviour; only
    // teardown-caused aborts are artefacts.
    const events = createPageEvents();
    expect(recordRequestFailure(events, failure())).toBe(true);
    expect(events.failedRequests).toHaveLength(1);
  });

  test('drops an abort caused by the teardown', () => {
    const events = createPageEvents();
    events.tearingDown = true;
    expect(recordRequestFailure(events, failure())).toBe(false);
    expect(events.failedRequests).toEqual([]);
  });

  test('still records a REAL failure during teardown', () => {
    // Teardown is not a blanket amnesty: a connection refused while closing is
    // not something the close can explain away.
    const events = createPageEvents();
    events.tearingDown = true;
    expect(
      recordRequestFailure(events, failure({ errorText: 'net::ERR_CONNECTION_REFUSED' })),
    ).toBe(true);
    expect(events.failedRequests).toHaveLength(1);
  });

  test('ignores a request the page never started', () => {
    const events = createPageEvents();
    expect(recordRequestFailure(events, failure({ wasPending: false }))).toBe(false);
    expect(events.failedRequests).toEqual([]);
  });

  test('caps the list so one broken page cannot flood the finding', () => {
    const events = createPageEvents();
    for (let i = 0; i < MAX_FAILED_REQUESTS + 5; i++) {
      recordRequestFailure(events, failure({ errorText: 'failed', label: `GET /x${i}` }));
    }
    expect(events.failedRequests).toHaveLength(MAX_FAILED_REQUESTS);
  });

  test('falls back to a generic label when Chromium gives no error text', () => {
    const events = createPageEvents();
    recordRequestFailure(events, failure({ errorText: '' }));
    expect(events.failedRequests[0]).toContain(': failed');
  });
});

describe('snapshotPageEvents', () => {
  test('copies by value, so a later push cannot reach a returned finding', () => {
    // The leak this closes: the worker assigned the LIVE arrays into the
    // finding before closing the page, so every abort the close produced was
    // pushed into a result that had already been filled in.
    const events = createPageEvents();
    recordRequestFailure(events, failure({ errorText: 'failed' }));
    const snapshot = snapshotPageEvents(events);

    events.failedRequests.push('GET /late: net::ERR_ABORTED');
    events.consoleErrors.push('late console error');
    events.pageErrors.push('late page error');
    events.serverErrors.push('500 /late');

    expect(snapshot.failedRequests).toHaveLength(1);
    expect(snapshot.consoleErrors).toEqual([]);
    expect(snapshot.pageErrors).toEqual([]);
    expect(snapshot.serverErrors).toEqual([]);
  });

  test('reports the requests still in flight, capped', () => {
    const events = createPageEvents();
    for (let i = 0; i < MAX_FAILED_REQUESTS + 3; i++) {
      events.pendingRequests.set({ i }, `GET /pending${i}`);
    }
    expect(snapshotPageEvents(events).pendingRequests).toHaveLength(MAX_FAILED_REQUESTS);
  });
});
