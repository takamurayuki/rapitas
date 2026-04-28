import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isExternalLink, handleExternalLinkClick } from '../external-links';

// Mock tauri utils
vi.mock('@/utils/tauri', () => ({
  isTauri: () => false,
  openExternalUrlInSplitView: vi.fn(),
}));

describe('isExternalLink', () => {
  beforeEach(() => {
    // Set window.location for tests
    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost' },
      writable: true,
    });
  });

  it('returns false for relative paths', () => {
    expect(isExternalLink('/about')).toBe(false);
    expect(isExternalLink('/tasks/123')).toBe(false);
  });

  it('returns false for anchor links', () => {
    expect(isExternalLink('#section')).toBe(false);
  });

  it('returns false for mailto links', () => {
    expect(isExternalLink('mailto:user@example.com')).toBe(false);
  });

  it('returns false for tel links', () => {
    expect(isExternalLink('tel:+1234567890')).toBe(false);
  });

  it('returns true for external URLs', () => {
    expect(isExternalLink('https://example.com')).toBe(true);
    expect(isExternalLink('https://google.com/search')).toBe(true);
  });

  it('returns false for same domain URLs', () => {
    expect(isExternalLink('http://localhost/page')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(isExternalLink('not-a-valid-url')).toBe(false);
  });
});

describe('handleExternalLinkClick', () => {
  it('does not prevent default for Ctrl+click', () => {
    const event = {
      ctrlKey: true,
      metaKey: false,
      button: 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    handleExternalLinkClick(event, 'https://example.com');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not prevent default for middle click', () => {
    const event = {
      ctrlKey: false,
      metaKey: false,
      button: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    handleExternalLinkClick(event, 'https://example.com');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('prevents default and opens split view for external links', () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const event = {
      ctrlKey: false,
      metaKey: false,
      button: 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as MouseEvent;

    handleExternalLinkClick(event, 'https://example.com');
    expect(event.preventDefault).toHaveBeenCalled();
    windowOpenSpy.mockRestore();
  });

  it('does nothing for internal links', () => {
    const event = {
      ctrlKey: false,
      metaKey: false,
      button: 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    handleExternalLinkClick(event, '/internal-page');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
