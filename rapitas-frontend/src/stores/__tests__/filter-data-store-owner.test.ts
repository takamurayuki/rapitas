/**
 * filter-data-store-owner.test
 *
 * The filter store persists categories and themes to localStorage under the
 * fixed key `filter-data-store`, with nothing identifying whose they are, and
 * `logout()` cleared only the auth state. So after signing out and signing in
 * as someone else in the same browser, `onRehydrateStorage` handed the new
 * session the previous user's categories and themes.
 *
 * The guard here is deliberately self-healing rather than logout-driven: a
 * crash, a cleared cookie, or an expired session never runs a logout handler,
 * so the cache has to notice on its own that its owner changed.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

/** Resolvers for the in-flight fetches, so a switch can land mid-request. */
let pending: Array<(value: unknown) => void> = [];
vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(
    (path: string) =>
      new Promise((resolve) => {
        pending.push(() => resolve(path === '/categories' ? [{ id: 9, name: 'from-user-A' }] : []));
      }),
  ),
  clearApiCache: vi.fn(),
}));

import { useFilterDataStore } from '@/stores/filter-data-store';
import type { Category, Theme } from '@/types';

function category(id: number, name: string): Category {
  return { id, name } as Category;
}
function theme(id: number, name: string): Theme {
  return { id, name } as Theme;
}

/** Seed the store as if user `owner` had populated it. */
function seedFor(owner: string | null) {
  useFilterDataStore.setState({
    categories: [category(1, 'owner-A-category')],
    themes: [theme(1, 'owner-A-theme')],
    lastUpdated: Date.now(),
    isInitialized: true,
    ownerUserId: owner,
  });
}

beforeEach(() => {
  pending = [];
  useFilterDataStore.setState({
    categories: [],
    themes: [],
    lastUpdated: null,
    isInitialized: false,
    isLoading: false,
    error: null,
    ownerUserId: null,
  });
});

describe('syncCacheOwner', () => {
  it('discards a cache that belongs to a different user', () => {
    seedFor('user-A');

    useFilterDataStore.getState().syncCacheOwner('user-B');

    const state = useFilterDataStore.getState();
    expect(state.categories).toEqual([]);
    expect(state.themes).toEqual([]);
    expect(state.isInitialized).toBe(false);
    expect(state.ownerUserId).toBe('user-B');
  });

  it('keeps the cache when the same user signs in again', () => {
    seedFor('user-A');

    useFilterDataStore.getState().syncCacheOwner('user-A');

    const state = useFilterDataStore.getState();
    expect(state.categories).toHaveLength(1);
    expect(state.isInitialized).toBe(true);
  });

  it('discards on sign-out, so nothing is left at rest for the next person', () => {
    seedFor('user-A');

    useFilterDataStore.getState().syncCacheOwner(null);

    expect(useFilterDataStore.getState().categories).toEqual([]);
    expect(useFilterDataStore.getState().ownerUserId).toBeNull();
  });

  it('adopts a cache that has no recorded owner rather than trusting it', () => {
    // Entries persisted before this field existed carry no owner. They cannot
    // be attributed, so they are discarded, not inherited.
    seedFor(null);

    useFilterDataStore.getState().syncCacheOwner('user-A');

    expect(useFilterDataStore.getState().categories).toEqual([]);
    expect(useFilterDataStore.getState().ownerUserId).toBe('user-A');
  });

  it('is idempotent — repeated calls for one user do not keep clearing', () => {
    useFilterDataStore.getState().syncCacheOwner('user-A');
    useFilterDataStore.setState({
      categories: [category(2, 'fresh')],
      isInitialized: true,
    });

    useFilterDataStore.getState().syncCacheOwner('user-A');
    useFilterDataStore.getState().syncCacheOwner('user-A');

    expect(useFilterDataStore.getState().categories).toHaveLength(1);
    expect(useFilterDataStore.getState().isInitialized).toBe(true);
  });
});

describe('persisted shape', () => {
  it('records the owner alongside the data it owns', () => {
    // Without ownerUserId in the persisted slice the guard would reset to null
    // on every reload and discard a cache its rightful owner could have kept.
    useFilterDataStore.getState().syncCacheOwner('user-A');
    expect(useFilterDataStore.getState().ownerUserId).toBe('user-A');
  });
});

// Reproduced 2026-10-31 by an external review: clearing on a switch is not
// enough, because a fetch started as the previous user resolves AFTERWARDS and
// writes its result straight into the freshly cleared store. The data comes
// back without anyone signing in again.
describe('a response that lands after the switch', () => {
  it('is discarded instead of repopulating the cache', async () => {
    useFilterDataStore.getState().syncCacheOwner('user-A');
    const inFlight = useFilterDataStore.getState().initializeData();

    // The switch happens while the request is still open.
    useFilterDataStore.getState().syncCacheOwner('user-B');
    pending.forEach((resolve) => resolve(undefined));
    await inFlight;

    const state = useFilterDataStore.getState();
    expect(state.categories).toEqual([]);
    expect(state.isInitialized).toBe(false);
    expect(state.ownerUserId).toBe('user-B');
  });

  it('is discarded when the switch is a sign-out', async () => {
    useFilterDataStore.getState().syncCacheOwner('user-A');
    const inFlight = useFilterDataStore.getState().initializeData();

    useFilterDataStore.getState().syncCacheOwner(null);
    pending.forEach((resolve) => resolve(undefined));
    await inFlight;

    expect(useFilterDataStore.getState().categories).toEqual([]);
  });

  // Adopting is not switching. At startup a page can load before the auth
  // effect reports who is signed in, so the owner goes null -> A while the
  // first fetch is open. That data belongs to A — discarding it would leave
  // the filters empty on the first view.
  it('is kept when the owner was merely unknown when it started', async () => {
    const inFlight = useFilterDataStore.getState().initializeData();

    useFilterDataStore.getState().syncCacheOwner('user-A');
    pending.forEach((resolve) => resolve(undefined));
    await inFlight;

    expect(useFilterDataStore.getState().categories).toHaveLength(1);
    expect(useFilterDataStore.getState().isInitialized).toBe(true);
  });

  it('is kept when the owner never changed', async () => {
    useFilterDataStore.getState().syncCacheOwner('user-A');
    const inFlight = useFilterDataStore.getState().initializeData();

    pending.forEach((resolve) => resolve(undefined));
    await inFlight;

    expect(useFilterDataStore.getState().categories).toHaveLength(1);
  });
});
