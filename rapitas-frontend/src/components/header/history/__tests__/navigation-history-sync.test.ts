/**
 * navigation-history-sync.test
 *
 * Drives the real (jsdom) History API through the installed sync and checks
 * that the store's position — and so the header's back/forward enablement —
 * follows push, replace, traversal and entries it never recorded.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installNavigationHistorySync, NAV_HISTORY_STATE_KEY } from '../navigation-history-sync';
import {
  selectCanGoBack,
  selectCanGoForward,
  useNavigationHistoryStore,
} from '../navigation-history-store';

const state = () => useNavigationHistoryStore.getState();
const canBack = () => selectCanGoBack(state());
const canForward = () => selectCanGoForward(state());

/** Traverses and resolves once the browser has fired popstate. */
const traverse = (delta: number) =>
  new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history.go(delta);
  });

let uninstall: () => void = () => {};

describe('navigation history sync', () => {
  beforeEach(() => {
    useNavigationHistoryStore.setState({ entries: [], index: -1 });
    window.history.replaceState(null, '', '/');
    uninstall = installNavigationHistorySync();
  });

  afterEach(() => {
    uninstall();
  });

  it('starts with nothing to go back or forward to', () => {
    expect(state().entries).toEqual(['/']);
    expect(canBack()).toBe(false);
    expect(canForward()).toBe(false);
  });

  it('enables back after a push (router.push) and records pathname + search', () => {
    window.history.pushState(null, '', '/dashboard?tab=week');
    expect(state().entries).toEqual(['/', '/dashboard?tab=week']);
    expect(canBack()).toBe(true);
    expect(canForward()).toBe(false);
  });

  it('replaces the current record on replaceState (router.replace) without adding history', () => {
    window.history.pushState(null, '', '/kanban?q=abc');
    window.history.replaceState(null, '', '/kanban');
    expect(state().entries).toEqual(['/', '/kanban']);
    expect(state().index).toBe(1);
  });

  it('follows browser back/forward (popstate) to the exact entry', async () => {
    window.history.pushState(null, '', '/a');
    window.history.pushState(null, '', '/b');

    await traverse(-1);
    expect(state().index).toBe(1);
    expect(canBack()).toBe(true);
    expect(canForward()).toBe(true);

    await traverse(-1);
    expect(state().index).toBe(0);
    expect(canBack()).toBe(false);
    expect(canForward()).toBe(true);

    await traverse(2);
    expect(state().index).toBe(2);
    expect(canForward()).toBe(false);
  });

  it('drops forward entries when pushing after going back', async () => {
    window.history.pushState(null, '', '/a');
    window.history.pushState(null, '', '/b');
    await traverse(-1);
    window.history.pushState(null, '', '/c');
    expect(state().entries).toEqual(['/', '/a', '/c']);
    expect(canForward()).toBe(false);
  });

  it('keeps the position when the router re-writes a traversed entry with its state spread in', async () => {
    window.history.pushState({ __NA: true }, '', '/a');
    window.history.pushState({ __NA: true }, '', '/b');
    await traverse(-1);
    // What the Next.js app router does after a restore (preserveCustomHistoryState).
    window.history.replaceState({ ...window.history.state, __NA: true }, '', '/a');
    expect(state().index).toBe(1);
    expect(state().entries).toEqual(['/', '/a', '/b']);
  });

  it('keeps the router’s own history state keys beside the tag', () => {
    window.history.pushState({ __NA: true, tree: 1 }, '', '/a');
    expect(window.history.state).toMatchObject({ __NA: true, tree: 1 });
    expect(window.history.state[NAV_HISTORY_STATE_KEY]).toMatchObject({ idx: 1 });
  });

  it('starts over when landing on an entry it never recorded (e.g. from before a reload)', async () => {
    uninstall();
    window.history.pushState({ [NAV_HISTORY_STATE_KEY]: { sid: 'old', idx: 7 } }, '', '/old');
    window.history.pushState(null, '', '/current');
    uninstall = installNavigationHistorySync();
    expect(canBack()).toBe(false);

    await traverse(-1);
    expect(state().entries).toEqual(['/old']);
    expect(canBack()).toBe(false);
    expect(canForward()).toBe(false);
  });

  it('is idempotent: a second install does not record each push twice', () => {
    const again = installNavigationHistorySync();
    expect(again).toBe(uninstall);
    window.history.pushState(null, '', '/once');
    expect(state().entries).toEqual(['/', '/once']);
  });
});
