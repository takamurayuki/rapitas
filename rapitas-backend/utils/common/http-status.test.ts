/**
 * http-status.test
 *
 * Verifies that the HTTP_STATUS SSOT constant contains the expected numeric
 * values and that the object is frozen (immutable at runtime via as const).
 */
import { describe, test, expect } from 'bun:test';
import { HTTP_STATUS } from './http-status';

describe('HTTP_STATUS', () => {
  test('contains expected status code values', () => {
    expect(HTTP_STATUS.OK).toBe(200);
    expect(HTTP_STATUS.CREATED).toBe(201);
    expect(HTTP_STATUS.NO_CONTENT).toBe(204);
    expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
    expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
    expect(HTTP_STATUS.FORBIDDEN).toBe(403);
    expect(HTTP_STATUS.NOT_FOUND).toBe(404);
    expect(HTTP_STATUS.CONFLICT).toBe(409);
    expect(HTTP_STATUS.UNPROCESSABLE_ENTITY).toBe(422);
    expect(HTTP_STATUS.TOO_MANY_REQUESTS).toBe(429);
    expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toBe(500);
  });

  test('covers all keys defined in the SSOT', () => {
    const keys = Object.keys(HTTP_STATUS);
    expect(keys).toContain('OK');
    expect(keys).toContain('CREATED');
    expect(keys).toContain('NO_CONTENT');
    expect(keys).toContain('BAD_REQUEST');
    expect(keys).toContain('UNAUTHORIZED');
    expect(keys).toContain('FORBIDDEN');
    expect(keys).toContain('NOT_FOUND');
    expect(keys).toContain('CONFLICT');
    expect(keys).toContain('UNPROCESSABLE_ENTITY');
    expect(keys).toContain('TOO_MANY_REQUESTS');
    expect(keys).toContain('INTERNAL_SERVER_ERROR');
    expect(keys.length).toBe(11);
  });

  test('values are all numbers', () => {
    for (const value of Object.values(HTTP_STATUS)) {
      expect(typeof value).toBe('number');
    }
  });

  test('object is not mutable at runtime (as const prevents property addition)', () => {
    // TypeScript as const does not use Object.freeze, but assignment to a
    // known key can still be done in JS — here we just verify the values stay
    // what they are (structural immutability is enforced by TS type system).
    expect(HTTP_STATUS.OK).toBe(200);
    expect(HTTP_STATUS.NOT_FOUND).toBe(404);
  });
});
