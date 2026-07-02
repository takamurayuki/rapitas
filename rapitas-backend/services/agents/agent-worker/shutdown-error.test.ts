/**
 * Tests for shutdown-error utility
 */

import { describe, it, expect } from 'bun:test';
import { SHUTDOWN_ERROR_MESSAGE, isShutdownError } from './shutdown-error';

describe('isShutdownError', () => {
  it.each([
    {
      desc: 'returns true for an Error with exact shutdown message',
      value: new Error(SHUTDOWN_ERROR_MESSAGE),
      expected: true,
    },
    {
      desc: 'returns false for an Error with a different message',
      value: new Error('Worker not ready'),
      expected: false,
    },
    {
      desc: 'returns false for an Error with a partial match',
      value: new Error('Manager is shutting down — extra text'),
      expected: false,
    },
    {
      desc: 'returns false for a plain string',
      value: SHUTDOWN_ERROR_MESSAGE,
      expected: false,
    },
    { desc: 'returns false for null', value: null, expected: false },
    { desc: 'returns false for undefined', value: undefined, expected: false },
    {
      desc: 'returns false for an object that is not an Error instance',
      value: { message: SHUTDOWN_ERROR_MESSAGE },
      expected: false,
    },
  ])('$desc', ({ value, expected }) => {
    expect(isShutdownError(value)).toBe(expected);
  });
});
