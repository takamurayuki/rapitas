/**
 * auth-session unit
 *
 * Pins the one decision that made a successful Google sign-in look like a
 * guest load: whether this page load should ask the backend who it is. The
 * localStorage hint alone is not enough, because it is per-origin and the
 * OAuth callback returns the browser to FRONTEND_URL — a different origin
 * from the one the button was clicked on whenever those differ by host.
 */
import { describe, it, expect } from 'vitest';
import { shouldValidateSession } from '../auth-session';

describe('shouldValidateSession', () => {
  it('validates when the hint says a session was established here', () => {
    expect(shouldValidateSession({ hasHint: true, search: '' })).toBe(true);
  });

  it('skips the probe for a plain guest load', () => {
    // The whole point of the hint: never-signed-in loads must not 401 on
    // every page view just to learn what they already know.
    expect(shouldValidateSession({ hasHint: false, search: '' })).toBe(false);
  });

  it('validates on the Google return even with no hint', () => {
    // The regression (2026-10-29): the hint was written on localhost:3000,
    // the callback returned to 127.0.0.1:3000, and a valid session cookie
    // went unnoticed because nothing probed for it.
    expect(shouldValidateSession({ hasHint: false, search: '?auth_success=true' })).toBe(true);
  });

  it('finds the marker among other query params', () => {
    expect(
      shouldValidateSession({ hasHint: false, search: '?from=google&auth_success=true&x=1' }),
    ).toBe(true);
  });

  it('accepts a search string with no leading question mark', () => {
    expect(shouldValidateSession({ hasHint: false, search: 'auth_success=true' })).toBe(true);
  });

  it.each(['?auth_success=false', '?auth_success=', '?auth_success', '?auth_succeeded=true'])(
    'does not validate on %s',
    (search) => {
      expect(shouldValidateSession({ hasHint: false, search })).toBe(false);
    },
  );

  it('treats a malformed search string as no marker rather than throwing', () => {
    expect(shouldValidateSession({ hasHint: false, search: '?%' })).toBe(false);
  });
});
