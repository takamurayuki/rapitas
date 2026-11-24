/**
 * confirm-link-token.test
 *
 * Signing, verification and 24-hour expiry of external confirm-link tokens
 * (acceptance criteria 1 and 6 of task 1430).
 */
import { describe, expect, test } from 'bun:test';
import {
  CONFIRM_LINK_TTL_MS,
  generateConfirmLinkId,
  resolveConfirmLinkSecret,
  signConfirmLinkToken,
  verifyConfirmLinkToken,
} from '../confirm-link-token';

const SECRET = 'k'.repeat(40);
const ISSUED_AT = 1_800_000_000_000;
const linkId = generateConfirmLinkId();
const expiresAt = ISSUED_AT + CONFIRM_LINK_TTL_MS;
const token = signConfirmLinkToken({ linkId, expiresAt }, SECRET);

describe('confirm-link token', () => {
  test('TTL is exactly 24 hours', () => {
    expect(CONFIRM_LINK_TTL_MS).toBe(86_400_000);
  });

  test('a fresh token verifies one millisecond before expiry', () => {
    expect(verifyConfirmLinkToken(token, SECRET, expiresAt - 1)).toEqual({
      ok: true,
      linkId,
      expiresAt,
    });
  });

  test('a token is expired exactly 24 hours after issue', () => {
    expect(verifyConfirmLinkToken(token, SECRET, expiresAt)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  test('changing one character of the signature is rejected as bad_signature', () => {
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    const tampered = token.slice(0, -1) + last;
    expect(verifyConfirmLinkToken(tampered, SECRET, ISSUED_AT)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('extending the expiry without re-signing is rejected as bad_signature', () => {
    const [v, id, , sig] = token.split('.');
    const forged = [v, id, String(expiresAt + CONFIRM_LINK_TTL_MS), sig].join('.');
    expect(verifyConfirmLinkToken(forged, SECRET, expiresAt + 1)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('a different key is rejected as bad_signature', () => {
    expect(verifyConfirmLinkToken(token, 'z'.repeat(40), ISSUED_AT)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test.each([
    ['wrong separator count', token.split('.').slice(0, 3).join('.')],
    ['wrong version', token.replace(/^v1/, 'v2')],
    [
      'non-numeric expiry',
      token
        .split('.')
        .map((p, i) => (i === 2 ? 'abc' : p))
        .join('.'),
    ],
    ['empty', ''],
  ])('%s is malformed', (_label, value) => {
    expect(verifyConfirmLinkToken(value, SECRET, ISSUED_AT)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  test('link ids are 128-bit base64url values and differ per call', () => {
    expect(linkId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generateConfirmLinkId()).not.toBe(linkId);
  });

  test('the secret is only honoured at 32 characters or more', () => {
    expect(resolveConfirmLinkSecret({})).toBeNull();
    expect(resolveConfirmLinkSecret({ RAPITAS_CONFIRM_LINK_SECRET: 'short' })).toBeNull();
    expect(resolveConfirmLinkSecret({ RAPITAS_CONFIRM_LINK_SECRET: SECRET })).toBe(SECRET);
  });
});
