/**
 * webview-occlusion-store.test
 *
 * Every overlay hides the in-app browser, but ラピ's window on the desktop
 * treats them by kind (#1541): a menu leaves her be, a dialog hides her, and
 * the restart overlay keeps her in sight but out of reach.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  rapiPresenceOf,
  useOccludesWebview,
  useWebviewOcclusionStore,
} from '../webview-occlusion-store';

beforeEach(() => useWebviewOcclusionStore.setState({ occluders: [] }));

describe('what an overlay is', () => {
  it('is a menu unless the caller says otherwise', () => {
    renderHook(() => useOccludesWebview(true));
    expect(useWebviewOcclusionStore.getState().occluders[0]).toMatch(/^menu-/);
  });

  it('carries the kind it was registered with', () => {
    renderHook(() => useOccludesWebview(true, 'dialog'));
    renderHook(() => useOccludesWebview(true, 'blocking'));
    const ids = useWebviewOcclusionStore.getState().occluders;
    expect(ids.some((id) => id.startsWith('dialog-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('blocking-'))).toBe(true);
  });
});

describe('what it means for her', () => {
  it('leaves her be for menus', () => {
    expect(rapiPresenceOf(['menu-1', 'menu-2'])).toBe('shown');
  });

  it('keeps her in sight but out of reach while the app restarts', () => {
    expect(rapiPresenceOf(['menu-1', 'blocking-3'])).toBe('inert');
  });

  // A dialog wins: she is not drawn over it at all.
  it('hides her for a dialog, whatever else is open', () => {
    expect(rapiPresenceOf(['blocking-3', 'dialog-4'])).toBe('hidden');
  });
});
