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

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(async () => []),
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
