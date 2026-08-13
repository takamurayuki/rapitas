/**
 * api-headers.test
 *
 * Verifies the UI source header constants match the backend's hardcoded
 * values and that mergeUiSourceHeaders preserves all three HeadersInit shapes.
 */
import { describe, it, expect } from 'vitest';
import { UI_SOURCE_HEADER, UI_SOURCE_VALUE, mergeUiSourceHeaders } from '../api-headers';

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

  it('adds the UI source header when init has no headers', () => {
    const headers = mergeUiSourceHeaders({ method: 'GET' });
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
