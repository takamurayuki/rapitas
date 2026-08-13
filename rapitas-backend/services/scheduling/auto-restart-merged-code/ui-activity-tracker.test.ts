/**
 * ui-activity-tracker.test
 *
 * Monotonic-record semantics of the UI activity tracker: initial 0 (fail-open
 * quiet), forward-only updates, rejection of clock rewinds and non-finite
 * timestamps, and reset.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { recordUiRequest, getLastUiRequestAt, resetUiActivity } from './ui-activity-tracker';

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
