/**
 * frontend-url unit
 *
 * Why the default matters enough to pin. The session cookie is set by the
 * backend on host 127.0.0.1 with SameSite=Strict, and SameSite compares
 * host+scheme while ignoring the port — so a page served from
 * `localhost:3000` is CROSS-site to `127.0.0.1:3001` and never sends the
 * cookie. The Google callback redirects the browser to this URL right after
 * setting that cookie, so a `localhost` default sends the user back from
 * Google apparently signed in and still a guest.
 */
import { describe, it, expect } from 'bun:test';
import { frontendUrl, DEFAULT_FRONTEND_URL } from './frontend-url';

describe('frontendUrl', () => {
  it('defaults to the IP literal, not localhost', () => {
    expect(frontendUrl({})).toBe('http://127.0.0.1:3000');
    expect(DEFAULT_FRONTEND_URL).toBe('http://127.0.0.1:3000');
  });

  it('never defaults to a localhost host', () => {
    // The whole point: a default on a different HOST loses the session cookie.
    expect(frontendUrl({})).not.toContain('localhost');
  });

  it('uses an explicit FRONTEND_URL', () => {
    expect(frontendUrl({ FRONTEND_URL: 'http://127.0.0.1:4000' })).toBe('http://127.0.0.1:4000');
  });

  it('falls back when the value is blank or whitespace', () => {
    expect(frontendUrl({ FRONTEND_URL: '' })).toBe(DEFAULT_FRONTEND_URL);
    expect(frontendUrl({ FRONTEND_URL: '   ' })).toBe(DEFAULT_FRONTEND_URL);
  });

  it('drops a trailing slash, because every caller appends a path', () => {
    // `${frontendUrl()}/auth?error=...` would otherwise produce `//auth`.
    expect(frontendUrl({ FRONTEND_URL: 'http://127.0.0.1:3000/' })).toBe('http://127.0.0.1:3000');
  });

  it('trims surrounding whitespace from a pasted value', () => {
    expect(frontendUrl({ FRONTEND_URL: ' http://127.0.0.1:3000 ' })).toBe('http://127.0.0.1:3000');
  });
});
