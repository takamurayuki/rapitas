/**
 * Tests for shutdown-error utility
 */

import { describe, it, expect } from 'bun:test';
import { SHUTDOWN_ERROR_MESSAGE, isShutdownError } from './shutdown-error';

describe('isShutdownError', () => {
  it('returns true for an Error with exact shutdown message', () => {
    expect(isShutdownError(new Error(SHUTDOWN_ERROR_MESSAGE))).toBe(true);
  });

  it('returns false for an Error with a different message', () => {
    expect(isShutdownError(new Error('Worker not ready'))).toBe(false);
  });

  it('returns false for an Error with a partial match', () => {
    expect(isShutdownError(new Error('Manager is shutting down — extra text'))).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isShutdownError(SHUTDOWN_ERROR_MESSAGE)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isShutdownError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isShutdownError(undefined)).toBe(false);
  });

  it('returns false for an object that is not an Error instance', () => {
    expect(isShutdownError({ message: SHUTDOWN_ERROR_MESSAGE })).toBe(false);
  });
});
