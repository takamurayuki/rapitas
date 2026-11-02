/**
 * app-shell unit
 *
 * The point of having one predicate is that three places agree: the header
 * that hides itself, the content wrapper that reserves the side nav's width,
 * and the avatar. When they disagreed, the sign-in form kept an empty 18rem
 * column on its left where the nav was not.
 */
import { describe, it, expect } from 'vitest';
import { isAppShellHidden } from '../app-shell';

describe('isAppShellHidden', () => {
  it.each(['/auth', '/auth/login', '/auth/register'])('hides the shell on %s', (path) => {
    expect(isAppShellHidden(path)).toBe(true);
  });

  it.each(['/quick-capture', '/notification-toast', '/pomodoro-float'])(
    'hides the shell in the %s popup window',
    (path) => {
      expect(isAppShellHidden(path)).toBe(true);
    },
  );

  it.each(['/', '/dashboard', '/tasks/12', '/settings'])('keeps the shell on %s', (path) => {
    expect(isAppShellHidden(path)).toBe(false);
  });

  it('matches whole segments, not a bare string prefix', () => {
    // '/authors'.startsWith('/auth') is true; the page would lose its header.
    expect(isAppShellHidden('/authors')).toBe(false);
  });

  it('treats an absent pathname as a normal page', () => {
    expect(isAppShellHidden(null)).toBe(false);
    expect(isAppShellHidden(undefined)).toBe(false);
  });
});
