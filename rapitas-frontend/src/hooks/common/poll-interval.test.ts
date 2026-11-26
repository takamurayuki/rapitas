/**
 * poll-interval.test
 *
 * Task 1553: while rapitas is in the background, periodic polls stretch to
 * 4× their interval (capped at 5 minutes) and snap back when it returns.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  HIDDEN_POLL_MULTIPLIER,
  MAX_HIDDEN_POLL_MS,
  isPollHidden,
  resolvePollInterval,
  usePollHidden,
} from './poll-interval';
import { setAppHidden } from './app-visibility-store';

function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  setDocumentHidden(false);
  setAppHidden(false);
});

describe('resolvePollInterval', () => {
  it('keeps the base interval while visible', () => {
    expect(resolvePollInterval(30_000, false)).toBe(30_000);
  });

  it('stretches 4× while hidden', () => {
    expect(HIDDEN_POLL_MULTIPLIER).toBe(4);
    expect(resolvePollInterval(30_000, true)).toBe(120_000);
    expect(resolvePollInterval(8_000, true)).toBe(32_000);
  });

  it('caps at 5 minutes while hidden', () => {
    expect(MAX_HIDDEN_POLL_MS).toBe(300_000);
    expect(resolvePollInterval(120_000, true)).toBe(300_000);
  });

  it('never shortens an interval that is already longer than the cap', () => {
    expect(resolvePollInterval(600_000, true)).toBe(600_000);
  });
});

describe('isPollHidden / usePollHidden', () => {
  it('is true when the document is hidden or the app window is minimized', () => {
    expect(isPollHidden()).toBe(false);
    setDocumentHidden(true);
    expect(isPollHidden()).toBe(true);
    setDocumentHidden(false);
    setAppHidden(true);
    expect(isPollHidden()).toBe(true);
  });

  it('re-renders on visibilitychange and on minimize/restore', () => {
    const { result } = renderHook(() => usePollHidden());
    expect(result.current).toBe(false);
    act(() => setDocumentHidden(true));
    expect(result.current).toBe(true);
    act(() => setDocumentHidden(false));
    expect(result.current).toBe(false);
    act(() => setAppHidden(true));
    expect(result.current).toBe(true);
    act(() => setAppHidden(false));
    expect(result.current).toBe(false);
  });
});
