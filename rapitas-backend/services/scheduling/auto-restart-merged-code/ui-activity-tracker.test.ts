/**
 * ui-activity-tracker.test
 *
 * Monotonic-record semantics of the UI activity tracker: initial 0 (fail-open
 * quiet), forward-only updates, rejection of clock rewinds and non-finite
 * timestamps, and reset. Plus the header classification (task 1548): only
 * `ui` is a user operation; `ui-poll` (background polling) is not.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import {
  recordUiRequest,
  getLastUiRequestAt,
  resetUiActivity,
  isUiOperationSource,
  recordUiRequestFromHeaders,
} from './ui-activity-tracker';

beforeEach(() => {
  resetUiActivity();
});

describe('ui-activity-tracker', () => {
  test('starts at 0 (never recorded = quiet, fail-open)', () => {
    expect(getLastUiRequestAt()).toBe(0);
  });

  test('records a timestamp and advances monotonically', () => {
    recordUiRequest(1_000);
    expect(getLastUiRequestAt()).toBe(1_000);
    recordUiRequest(2_000);
    expect(getLastUiRequestAt()).toBe(2_000);
  });

  test('ignores a backwards timestamp (clock rewind guard)', () => {
    recordUiRequest(5_000);
    recordUiRequest(3_000);
    expect(getLastUiRequestAt()).toBe(5_000);
  });

  test('ignores an equal timestamp without error', () => {
    recordUiRequest(5_000);
    recordUiRequest(5_000);
    expect(getLastUiRequestAt()).toBe(5_000);
  });

  test('ignores non-finite timestamps', () => {
    recordUiRequest(Number.NaN);
    recordUiRequest(Number.POSITIVE_INFINITY);
    expect(getLastUiRequestAt()).toBe(0);
  });

  test('reset returns to the never-recorded state', () => {
    recordUiRequest(9_000);
    resetUiActivity();
    expect(getLastUiRequestAt()).toBe(0);
  });
});

describe('X-Rapitas-Source classification (task 1548)', () => {
  test('only the exact value "ui" is a user operation', () => {
    expect(isUiOperationSource('ui')).toBe(true);
    expect(isUiOperationSource('ui-poll')).toBe(false);
    expect(isUiOperationSource('UI')).toBe(false);
    expect(isUiOperationSource('')).toBe(false);
    expect(isUiOperationSource(null)).toBe(false);
    expect(isUiOperationSource(undefined)).toBe(false);
  });

  test('a ui request is recorded as activity', () => {
    recordUiRequestFromHeaders(new Headers({ 'X-Rapitas-Source': 'ui' }), 7_000);
    expect(getLastUiRequestAt()).toBe(7_000);
  });

  test('a ui-poll request is not recorded', () => {
    recordUiRequestFromHeaders(new Headers({ 'X-Rapitas-Source': 'ui-poll' }), 7_000);
    expect(getLastUiRequestAt()).toBe(0);
  });

  test('a request without the header is not recorded', () => {
    recordUiRequestFromHeaders(new Headers(), 7_000);
    expect(getLastUiRequestAt()).toBe(0);
  });

  test('polling after an operation does not extend the activity window', () => {
    recordUiRequestFromHeaders(new Headers({ 'x-rapitas-source': 'ui' }), 1_000);
    recordUiRequestFromHeaders(new Headers({ 'x-rapitas-source': 'ui-poll' }), 9_000);
    expect(getLastUiRequestAt()).toBe(1_000);
  });

  // The only record point is server-main's onRequest hook; pin that it goes
  // through the classifier instead of comparing the header inline.
  test('server-main records through recordUiRequestFromHeaders', async () => {
    const src = await Bun.file(join(import.meta.dir, '../../../server-main.ts')).text();
    expect(src).toContain('recordUiRequestFromHeaders(request.headers, Date.now())');
    expect(src).not.toContain('=== UI_SOURCE_VALUE');
  });
});
