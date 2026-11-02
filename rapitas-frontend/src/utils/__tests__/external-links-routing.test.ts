/**
 * external-links-routing.test
 *
 * `openExternalLink` is the single point every external link in the app
 * passes through, so its branch decides where notes' and task descriptions'
 * links land. Covered separately from external-links.test.ts, which predates
 * the in-app pane and asserts the external path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const openExternalUrlInSplitView = vi.fn();
const openLinkInPane = vi.fn();
const getLinkOpenMode = vi.fn(() => 'external' as 'external' | 'internal');

vi.mock('@/utils/tauri', () => ({
  openExternalUrlInSplitView: (url: string) => openExternalUrlInSplitView(url),
}));

vi.mock('@/stores/link-view-store', () => ({
  openLinkInPane: (url: string) => openLinkInPane(url),
}));

vi.mock('@/utils/link-view', () => ({
  getLinkOpenMode: () => getLinkOpenMode(),
  canShowInLinkView: (url: string) => /^https?:\/\//i.test(url),
}));

import { openExternalLink } from '../external-links';

describe('openExternalLink', () => {
  beforeEach(() => {
    openExternalUrlInSplitView.mockClear();
    openLinkInPane.mockClear();
    getLinkOpenMode.mockReturnValue('external');
  });

  it('hands the link to the external browser by default', () => {
    openExternalLink('https://github.com/owner/repo');
    expect(openExternalUrlInSplitView).toHaveBeenCalledWith('https://github.com/owner/repo');
    expect(openLinkInPane).not.toHaveBeenCalled();
  });

  it('docks the link in the pane when the setting says internal', () => {
    getLinkOpenMode.mockReturnValue('internal');
    openExternalLink('https://github.com/owner/repo');
    expect(openLinkInPane).toHaveBeenCalledWith('https://github.com/owner/repo');
    expect(openExternalUrlInSplitView).not.toHaveBeenCalled();
  });

  // Turning the pane on must not strand mailto: — the pane cannot show it and
  // the Rust command rejects it, so it has to keep reaching the OS handler.
  it('still sends non-web links outward in internal mode', () => {
    getLinkOpenMode.mockReturnValue('internal');
    openExternalLink('mailto:someone@example.com');
    expect(openExternalUrlInSplitView).toHaveBeenCalledWith('mailto:someone@example.com');
    expect(openLinkInPane).not.toHaveBeenCalled();
  });
});
