import { describe, it, expect } from 'vitest';
import { getFaviconUrl, faviconServices } from '../favicon';

describe('getFaviconUrl', () => {
  it('returns Google favicon URL for valid URL', () => {
    expect(getFaviconUrl('https://example.com/page')).toBe(
      'https://www.google.com/s2/favicons?domain=example.com&sz=64',
    );
  });

  it('extracts domain from URL with path', () => {
    expect(getFaviconUrl('https://sub.example.com/path/to/page')).toBe(
      'https://www.google.com/s2/favicons?domain=sub.example.com&sz=64',
    );
  });

  it('handles URL with port', () => {
    expect(getFaviconUrl('http://localhost:3000')).toBe(
      'https://www.google.com/s2/favicons?domain=localhost&sz=64',
    );
  });

  it('returns empty string for invalid URL', () => {
    expect(getFaviconUrl('not-a-url')).toBe('');
    expect(getFaviconUrl('')).toBe('');
  });
});

describe('faviconServices', () => {
  it('generates correct URLs for each service', () => {
    const domain = 'example.com';
    expect(faviconServices.google(domain)).toContain(domain);
    expect(faviconServices.duckduckgo(domain)).toContain(domain);
    expect(faviconServices.clearbit(domain)).toContain(domain);
    expect(faviconServices.faviconkit(domain)).toContain(domain);
  });
});
