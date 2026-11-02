/**
 * LinkViewPane.test
 *
 * The address bar takes whatever is typed, and the webview only accepts
 * http(s) — so what counts as navigable is the part worth pinning.
 */
import { describe, it, expect } from 'vitest';
import { toNavigableUrl } from './LinkViewPane';

describe('toNavigableUrl', () => {
  it('keeps a full URL', () => {
    expect(toNavigableUrl('https://x.example/a?b=1')).toBe('https://x.example/a?b=1');
    expect(toNavigableUrl('http://x.example/')).toBe('http://x.example/');
  });

  // Typing a bare host is the usual thing to do.
  it('adds https to a bare host', () => {
    expect(toNavigableUrl('x.example')).toBe('https://x.example/');
    expect(toNavigableUrl('  x.example/path  ')).toBe('https://x.example/path');
  });

  // The pane is inside the app window; these would be escalation sinks, and
  // the Rust command rejects them anyway.
  it('refuses anything that is not http(s)', () => {
    expect(toNavigableUrl('javascript:alert(1)')).toBeNull();
    expect(toNavigableUrl('file:///C:/secret.txt')).toBeNull();
    expect(toNavigableUrl('data:text/html,<script></script>')).toBeNull();
  });

  it('refuses an empty field', () => {
    expect(toNavigableUrl('')).toBeNull();
    expect(toNavigableUrl('   ')).toBeNull();
  });
});
