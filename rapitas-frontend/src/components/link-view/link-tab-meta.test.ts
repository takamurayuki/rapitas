/**
 * link-tab-meta.test
 *
 * The merge rules are the part that is easy to get wrong. A tab that has
 * navigated must not keep describing the page it left (#1078), and a title
 * arriving for the page already shown must not be thrown away just because
 * the event repeated the URL.
 */
import { describe, it, expect } from 'vitest';
import { hostOf, tabLabel, faviconFor, nextTabMeta } from './link-tab-meta';

describe('hostOf', () => {
  it('reads the host out of a URL', () => {
    expect(hostOf('https://www.google.com/search?q=x')).toBe('www.google.com');
  });

  it('gives back what it was handed when that is not a URL', () => {
    expect(hostOf('not a url')).toBe('not a url');
  });
});

describe('tabLabel', () => {
  it('prefers the page title', () => {
    expect(tabLabel({ url: 'https://www.google.com/search?q=x', title: 'x - Google 検索' })).toBe(
      'x - Google 検索',
    );
  });

  it('falls back to the host before a title is known', () => {
    expect(tabLabel({ url: 'https://www.google.com/' })).toBe('www.google.com');
  });

  it('treats a blank title as no title', () => {
    expect(tabLabel({ url: 'https://www.google.com/', title: '   ' })).toBe('www.google.com');
  });
});

describe('faviconFor', () => {
  it('points at the icon service for the URL host', () => {
    expect(faviconFor('https://github.com/owner/repo')).toContain('github.com');
  });

  // A tab mid-edit can hold something unparseable; an <img> with a broken
  // src is worse than the globe placeholder the pane falls back to.
  it('gives nothing for a string that is not a URL', () => {
    expect(faviconFor('not a url')).toBe('');
  });
});

describe('nextTabMeta', () => {
  const start = { url: 'https://www.google.com/', title: 'Google' };

  // The reported bug: searching from the Google home page left both the
  // address bar and the tab heading on the home page (#1078).
  it('takes the new URL the webview reports', () => {
    expect(nextTabMeta(start, { url: 'https://www.google.com/search?q=rust' }).url).toBe(
      'https://www.google.com/search?q=rust',
    );
  });

  // The old title describes the old page. Keeping it would label the search
  // results "Google" until the title event happened to arrive.
  it('drops a title that belonged to the page just left', () => {
    expect(nextTabMeta(start, { url: 'https://example.com/' }).title).toBeUndefined();
  });

  it('takes a URL and title reported together', () => {
    const next = nextTabMeta(start, {
      url: 'https://www.google.com/search?q=rust',
      title: 'rust - Google 検索',
    });
    expect(next).toEqual({
      url: 'https://www.google.com/search?q=rust',
      title: 'rust - Google 検索',
    });
  });

  // The title arrives after the navigation, as its own event naming the
  // same URL — that must not read as "nothing changed, keep the old title".
  it('accepts a title for the page already shown', () => {
    const navigated = nextTabMeta(start, { url: 'https://www.google.com/search?q=rust' });
    const titled = nextTabMeta(navigated, {
      url: 'https://www.google.com/search?q=rust',
      title: 'rust - Google 検索',
    });
    expect(titled.title).toBe('rust - Google 検索');
  });

  it('keeps the URL when only a title is reported', () => {
    expect(nextTabMeta(start, { title: 'Still here' })).toEqual({
      url: 'https://www.google.com/',
      title: 'Still here',
    });
  });

  it('keeps the title when only the same URL is reported', () => {
    expect(nextTabMeta(start, { url: 'https://www.google.com/' }).title).toBe('Google');
  });

  it('ignores an empty or missing URL rather than blanking the tab', () => {
    expect(nextTabMeta(start, { url: '' }).url).toBe('https://www.google.com/');
    expect(nextTabMeta(start, { url: null }).url).toBe('https://www.google.com/');
    expect(nextTabMeta(start, {}).url).toBe('https://www.google.com/');
  });

  it('stores a trimmed title and discards a blank one', () => {
    expect(nextTabMeta(start, { title: '  spaced  ' }).title).toBe('spaced');
    expect(nextTabMeta(start, { title: '   ' }).title).toBe('Google');
  });
});
