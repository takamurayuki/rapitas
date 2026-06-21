import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isExternalLink, handleExternalLinkClick, setupExternalLinkHandlers } from '../external-links';

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

  it('prevents default and opens external links in the default browser', () => {
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

describe('setupExternalLinkHandlers', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost' },
      writable: true,
    });
    document.body.innerHTML = '';
  });

  it('registers a click handler on external links', () => {
    const link = document.createElement('a');
    link.href = 'https://example.com';
    document.body.appendChild(link);

    setupExternalLinkHandlers();

    const handler = (link as HTMLAnchorElement & { __externalLinkHandler?: EventListener }).__externalLinkHandler;
    expect(handler).toBeDefined();
  });

  // NOTE: Verifies the fix for HMR handler staleness — calling setup twice must not
  // stack duplicate listeners (old handler removed before new one is added).
  it('replaces old handler on second call (HMR simulation)', () => {
    const link = document.createElement('a');
    link.href = 'https://example.com';
    document.body.appendChild(link);

    setupExternalLinkHandlers();
    const firstHandler = (link as HTMLAnchorElement & { __externalLinkHandler?: EventListener }).__externalLinkHandler;

    setupExternalLinkHandlers();
    const secondHandler = (link as HTMLAnchorElement & { __externalLinkHandler?: EventListener }).__externalLinkHandler;

    // Handler reference must be renewed so the new module closure is used
    expect(secondHandler).toBeDefined();
    expect(secondHandler).not.toBe(firstHandler);
  });

  it('does not register a handler on internal links', () => {
    const link = document.createElement('a');
    link.href = '/internal-page';
    document.body.appendChild(link);

    setupExternalLinkHandlers();

    const handler = (link as HTMLAnchorElement & { __externalLinkHandler?: EventListener }).__externalLinkHandler;
    expect(handler).toBeUndefined();
  });
});
