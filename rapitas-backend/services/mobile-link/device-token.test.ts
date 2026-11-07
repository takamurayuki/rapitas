/**
 * device-token tests (#1421)
 */
import { describe, test, expect } from 'bun:test';
import { findDeviceByToken, hashToken, issueToken, readBearer } from './device-token';
import type { PairedDevice } from './mobile-link-store';

function device(id: string, tokenHash: string): PairedDevice {
  return { id, name: id, tokenHash, workspaceId: null, createdAt: '', lastSeenAt: null };
}

describe('issueToken', () => {
  test('tokens are long, unique, and stored only as their hash', () => {
    const a = issueToken();
    const b = issueToken();
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
  });
});

describe('findDeviceByToken', () => {
  test('matches the device whose hash fits, and nothing else', () => {
    const a = issueToken();
    const b = issueToken();
    const devices = [device('a', a.tokenHash), device('b', b.tokenHash)];
    expect(findDeviceByToken(devices, b.token)?.id).toBe('b');
    expect(findDeviceByToken(devices, 'guess')).toBeNull();
    expect(findDeviceByToken(devices, '')).toBeNull();
  });
});

describe('readBearer', () => {
  test('reads a bearer token and rejects anything else', () => {
    expect(readBearer('Bearer abc')).toBe('abc');
    expect(readBearer('bearer abc')).toBe('abc');
    expect(readBearer('Basic abc')).toBeNull();
    expect(readBearer('Bearer')).toBeNull();
    expect(readBearer(null)).toBeNull();
  });
});
