/**
 * session-workspace — the cookie parser
 *
 * Hand-rolled because Elysia's cookie plugin has not run yet at the point
 * this is needed, and a parser that returns the wrong token (or none) decides
 * which account's data a request sees. Enumerated rather than sampled.
 */
import { describe, test, expect } from 'bun:test';
import { readSessionToken } from './session-workspace';

describe('readSessionToken', () => {
  test('finds the token when it is the only cookie', () => {
    expect(readSessionToken('sessionToken=abc123')).toBe('abc123');
  });

  test('finds it among others, in any position', () => {
    expect(readSessionToken('theme=dark; sessionToken=abc123; locale=ja')).toBe('abc123');
    expect(readSessionToken('sessionToken=abc123; theme=dark')).toBe('abc123');
    expect(readSessionToken('theme=dark; sessionToken=abc123')).toBe('abc123');
  });

  test('tolerates the spacing browsers actually send', () => {
    expect(readSessionToken('theme=dark;sessionToken=abc123;locale=ja')).toBe('abc123');
    expect(readSessionToken('  sessionToken = abc123  ')).toBe('abc123');
  });

  test('decodes a percent-encoded value', () => {
    expect(readSessionToken('sessionToken=a%2Bb%3Dc')).toBe('a+b=c');
  });

  test('returns the raw value rather than throwing on a bad escape', () => {
    // A malformed cookie is not a session; it must not take the request down
    // from inside a request-path helper.
    expect(readSessionToken('sessionToken=%E0%A4%A')).toBe('%E0%A4%A');
  });

  // All of these mean "no session", and every one of them must reach the same
  // answer: null, which the wrapper serves unscoped.
  test.each([
    ['an empty value', 'sessionToken='],
    ['an empty value among others', 'theme=dark; sessionToken=; locale=ja'],
    ['no cookie header at all', null],
    ['an empty cookie header', ''],
    ['no cookie by that name', 'theme=dark; locale=ja'],
  ])('is absent for %s', (_label, header) => {
    expect(readSessionToken(header)).toBeNull();
  });

  test('does not match a cookie whose name merely contains the word', () => {
    // `xsessionToken` and `sessionTokenBackup` are different cookies; reading
    // either as the session would scope a request to the wrong account.
    expect(readSessionToken('xsessionToken=nope')).toBeNull();
    expect(readSessionToken('sessionTokenBackup=nope')).toBeNull();
    expect(readSessionToken('sessionTokenBackup=nope; sessionToken=yes')).toBe('yes');
  });

  test('keeps a value containing "=" intact', () => {
    // Only the FIRST `=` separates name from value; base64 padding is common.
    expect(readSessionToken('sessionToken=YWJjZA==')).toBe('YWJjZA==');
  });

  test('ignores a malformed segment with no "="', () => {
    expect(readSessionToken('broken; sessionToken=abc123')).toBe('abc123');
  });
});
