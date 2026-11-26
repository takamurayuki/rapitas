/**
 * api-headers.test
 *
 * Verifies the UI source header constants match the backend's hardcoded
 * values and that mergeUiSourceHeaders preserves all three HeadersInit shapes.
 */
import { describe, it, expect } from 'vitest';
import * as headersModule from '../api-headers';
import {
  UI_SOURCE_HEADER,
  UI_SOURCE_VALUE,
  UI_POLL_SOURCE_VALUE,
  mergeUiSourceHeaders,
  resolveUiSourceValue,
} from '../api-headers';

describe('UI source header constants', () => {
  // NOTE: These literals mirror rapitas-backend ui-activity-tracker.ts:13,16.
  // A drift here silently disables the UI-quiet restart gate (fail-open).
  it('matches the backend header name', () => {
    expect(UI_SOURCE_HEADER).toBe('x-rapitas-source');
  });

  it('matches the backend header value', () => {
    expect(UI_SOURCE_VALUE).toBe('ui');
  });
});

describe('mergeUiSourceHeaders', () => {
  it('adds the UI source header when init is undefined', () => {
    const headers = mergeUiSourceHeaders(undefined);
    expect(headers.get(UI_SOURCE_HEADER)).toBe(UI_SOURCE_VALUE);
  });

  it('tags an explicit GET as ui-poll when the user has not just acted', () => {
    const headers = mergeUiSourceHeaders({ method: 'GET' });
    expect(headers.get(UI_SOURCE_HEADER)).toBe(UI_POLL_SOURCE_VALUE);
  });

  it('uses the method argument over init.method', () => {
    expect(mergeUiSourceHeaders({}, 'GET').get(UI_SOURCE_HEADER)).toBe(UI_POLL_SOURCE_VALUE);
    expect(mergeUiSourceHeaders({}, 'POST').get(UI_SOURCE_HEADER)).toBe(UI_SOURCE_VALUE);
    // The form the settings poll and the theme favorites GET use.
    expect(mergeUiSourceHeaders(undefined, 'GET').get(UI_SOURCE_HEADER)).toBe(UI_POLL_SOURCE_VALUE);
    expect(mergeUiSourceHeaders(undefined, 'POST').get(UI_SOURCE_HEADER)).toBe(UI_SOURCE_VALUE);
  });

  // Callers pass only `{ headers }` here and set method on the outer fetch
  // init (approve-plan POST among them), so an unknown method must stay `ui`.
  it('keeps ui when the method is unknown', () => {
    const headers = mergeUiSourceHeaders({ headers: { 'Content-Type': 'application/json' } });
    expect(headers.get(UI_SOURCE_HEADER)).toBe(UI_SOURCE_VALUE);
  });

  it('preserves caller headers given as a plain object', () => {
    const headers = mergeUiSourceHeaders({
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    });
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer token');
    expect(headers.get(UI_SOURCE_HEADER)).toBe(UI_SOURCE_VALUE);
  });

  it('preserves caller headers given as a Headers instance', () => {
    const callerHeaders = new Headers();
    callerHeaders.set('Content-Type', 'application/json');
    const headers = mergeUiSourceHeaders({ headers: callerHeaders });
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get(UI_SOURCE_HEADER)).toBe(UI_SOURCE_VALUE);
  });

  it('preserves caller headers given as a [key, value][] array', () => {
    const headers = mergeUiSourceHeaders({
      headers: [
        ['Content-Type', 'application/json'],
        ['X-Custom', 'abc'],
      ],
    });
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-custom')).toBe('abc');
    expect(headers.get(UI_SOURCE_HEADER)).toBe(UI_SOURCE_VALUE);
  });

  it('does not overwrite a caller-provided x-rapitas-source value', () => {
    const headers = mergeUiSourceHeaders({
      headers: { 'X-Rapitas-Source': 'custom-caller-value' },
    });
    expect(headers.get(UI_SOURCE_HEADER)).toBe('custom-caller-value');
  });

  it('does not mutate the caller-provided Headers instance', () => {
    const callerHeaders = new Headers({ 'Content-Type': 'text/plain' });
    mergeUiSourceHeaders({ headers: callerHeaders });
    expect(callerHeaders.has(UI_SOURCE_HEADER)).toBe(false);
  });
});

describe('resolveUiSourceValue (task 1548)', () => {
  it('mutations are always ui', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      expect(resolveUiSourceValue(method)).toBe(UI_SOURCE_VALUE);
    }
  });

  it('a read is ui-poll unless the caller marks it as a user action', () => {
    expect(resolveUiSourceValue('GET')).toBe(UI_POLL_SOURCE_VALUE);
    expect(resolveUiSourceValue(undefined)).toBe(UI_POLL_SOURCE_VALUE);
    expect(resolveUiSourceValue('GET', { userAction: false })).toBe(UI_POLL_SOURCE_VALUE);
    expect(resolveUiSourceValue('GET', { userAction: true })).toBe(UI_SOURCE_VALUE);
    expect(resolveUiSourceValue(undefined, { userAction: true })).toBe(UI_SOURCE_VALUE);
  });

  // Regression (Q1): a click or key press must not turn the next poll into `ui`.
  it('a click or key press does not change how a read is tagged', () => {
    window.dispatchEvent(new Event('pointerdown'));
    expect(resolveUiSourceValue('GET')).toBe(UI_POLL_SOURCE_VALUE);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(resolveUiSourceValue('GET')).toBe(UI_POLL_SOURCE_VALUE);
  });

  // The old 5 s window's exports (and its window listener) must not come back.
  it('exports only the timing-free API', () => {
    expect(Object.keys(headersModule).sort()).toEqual([
      'UI_POLL_SOURCE_VALUE',
      'UI_SOURCE_HEADER',
      'UI_SOURCE_VALUE',
      'mergeUiSourceHeaders',
      'resolveUiSourceValue',
    ]);
  });

  it('the poll value matches the backend literal', () => {
    expect(UI_POLL_SOURCE_VALUE).toBe('ui-poll');
  });
});
