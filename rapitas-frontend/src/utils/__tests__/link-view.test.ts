/**
 * link-view.test
 *
 * The routing decision is the whole feature: a link must reach the in-app
 * pane only when the user asked for it AND the pane can actually show it.
 * Getting either half wrong sends links to the wrong place silently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const isTauriMock = vi.fn(() => true);

vi.mock('@/utils/tauri', () => ({
  isTauri: () => isTauriMock(),
  openExternalUrlInSplitView: vi.fn(),
  EXTERNAL_BROWSER_KEY: 'rapitas.externalBrowser',
}));

import {
  LINK_OPEN_MODE_KEY,
  canShowInLinkView,
  getLinkOpenMode,
  setLinkOpenMode,
} from '../link-view';

describe('getLinkOpenMode', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to external so an upgrade changes nothing', () => {
    expect(getLinkOpenMode()).toBe('external');
  });

  it('returns internal once the setting is stored', () => {
    localStorage.setItem(LINK_OPEN_MODE_KEY, 'internal');
    expect(getLinkOpenMode()).toBe('internal');
  });

  // There is no webview to dock into in the browser build, so honouring the
  // stored value there would route links into a pane that cannot exist.
  it('stays external outside Tauri even when internal is stored', () => {
    localStorage.setItem(LINK_OPEN_MODE_KEY, 'internal');
    isTauriMock.mockReturnValue(false);
    expect(getLinkOpenMode()).toBe('external');
  });

  it('treats an unrecognised stored value as external', () => {
    localStorage.setItem(LINK_OPEN_MODE_KEY, 'sideways');
    expect(getLinkOpenMode()).toBe('external');
  });
});

describe('setLinkOpenMode', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true);
    localStorage.clear();
  });

  it('round-trips through getLinkOpenMode', () => {
    setLinkOpenMode('internal');
    expect(getLinkOpenMode()).toBe('internal');
    setLinkOpenMode('external');
    expect(getLinkOpenMode()).toBe('external');
  });

  it('clears the key rather than storing the default', () => {
    setLinkOpenMode('internal');
    setLinkOpenMode('external');
    expect(localStorage.getItem(LINK_OPEN_MODE_KEY)).toBeNull();
  });
});

describe('canShowInLinkView', () => {
  it('accepts web URLs', () => {
    expect(canShowInLinkView('https://github.com/owner/repo')).toBe(true);
    expect(canShowInLinkView('http://example.com')).toBe(true);
    expect(canShowInLinkView('HTTPS://EXAMPLE.COM')).toBe(true);
  });

  // These must keep reaching the OS handler even with the pane turned on,
  // and the Rust command rejects them anyway.
  it('rejects anything the pane cannot or must not show', () => {
    for (const url of [
      'mailto:someone@example.com',
      'tel:+81312345678',
      'javascript:alert(1)',
      'file:///C:/secret.txt',
      'data:text/html,<script></script>',
      '',
    ]) {
      expect(canShowInLinkView(url)).toBe(false);
    }
  });
});
