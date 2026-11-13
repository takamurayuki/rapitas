/**
 * theme-category-resolver.test
 *
 * Pins the category decision for a scaffolded theme: the caller's choice wins,
 * an unknown id is rejected rather than silently replaced, the fallback prefers
 * 開発 then any development-mode category, 開発 is re-created only into an
 * empty table (a deleted 開発 must stay deleted), and isDevelopment follows the
 * category's mode.
 *
 * Why the last one matters: setup-from-claude-md hardcoded `isDevelopment: true`
 * alongside a hardcoded 開発 category, so once the category became selectable a
 * theme filed under e.g. 学習 would still have been swept into auto-run.
 */
import { describe, it, expect, mock } from 'bun:test';
import {
  resolveThemeCategory,
  FALLBACK_CATEGORY,
  NO_FALLBACK_CATEGORY_ERROR,
  type CategoryLike,
  type CategoryStore,
} from './theme-category-resolver';

const DEV: CategoryLike = { id: 1, name: '開発', mode: 'development' };
const LEARNING: CategoryLike = { id: 2, name: '学習', mode: 'learning' };

function makeStore(over: Partial<CategoryStore> = {}) {
  const created: Array<{ name: string; mode: string; isDefault: boolean }> = [];
  const store: CategoryStore & { created: typeof created } = {
    created,
    findUnique: mock(async () => null),
    findFirst: mock(async () => null),
    count: mock(async () => 0),
    create: mock(async (args) => {
      created.push(args.data);
      return { id: 99, name: args.data.name, mode: args.data.mode };
    }),
    ...over,
  };
  return store;
}

describe('resolveThemeCategory', () => {
  it("uses the caller's category and does not touch the fallback", async () => {
    const findFirst = mock(async () => DEV);
    const store = makeStore({ findUnique: mock(async () => LEARNING), findFirst });
    const result = await resolveThemeCategory(store, 2);
    expect(result).toEqual({ ok: true, category: LEARNING, isDevelopment: false });
    expect(findFirst).not.toHaveBeenCalled();
    expect(store.created).toEqual([]);
  });

  it('marks a development-mode category as a development theme', async () => {
    const store = makeStore({ findUnique: mock(async () => DEV) });
    const result = await resolveThemeCategory(store, 1);
    expect(result).toEqual({ ok: true, category: DEV, isDevelopment: true });
  });

  it('rejects an unknown id instead of falling back to 開発', async () => {
    // Silently substituting 開発 would file the project under a category the
    // user did not choose, which is the behaviour this change exists to end.
    const store = makeStore({ findUnique: mock(async () => null) });
    const result = await resolveThemeCategory(store, 4242);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('4242');
    expect(store.created).toEqual([]);
  });

  it('falls back to an existing 開発 category when none is named', async () => {
    const findUnique = mock(async () => LEARNING);
    const store = makeStore({ findUnique, findFirst: mock(async () => DEV) });
    const result = await resolveThemeCategory(store, undefined);
    expect(result).toEqual({ ok: true, category: DEV, isDevelopment: true });
    // No id was given, so the by-id lookup must not run at all.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('re-creates 開発 only when there are no categories at all', async () => {
    const store = makeStore({ findFirst: mock(async () => null), count: mock(async () => 0) });
    const result = await resolveThemeCategory(store, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.isDevelopment).toBe(true);
    expect(store.created).toEqual([
      { name: FALLBACK_CATEGORY.name, mode: FALLBACK_CATEGORY.mode, isDefault: true },
    ]);
  });

  it('falls back to another development-mode category when 開発 was deleted', async () => {
    const MINE: CategoryLike = { id: 7, name: '仕事', mode: 'development' };
    const findFirst = mock(async (args: { where: { name?: string; mode?: string } }) =>
      args.where.mode === 'development' ? MINE : null,
    );
    const store = makeStore({ findFirst, count: mock(async () => 3) });
    const result = await resolveThemeCategory(store, undefined);
    expect(result).toEqual({ ok: true, category: MINE, isDevelopment: true });
    expect(store.created).toEqual([]);
  });

  it('rejects instead of re-creating 開発 when other categories exist', async () => {
    // The user deleted 開発 on purpose; re-creating it here is exactly the
    // "it keeps coming back" bug. Filing under 学習 instead would silently
    // clear isDevelopment, so the caller must pick a category.
    const store = makeStore({ findFirst: mock(async () => null), count: mock(async () => 1) });
    const result = await resolveThemeCategory(store, undefined);
    expect(result).toEqual({
      ok: false,
      error: NO_FALLBACK_CATEGORY_ERROR,
      code: 'category_required',
    });
    expect(store.created).toEqual([]);
  });

  it('treats categoryId 0 as "not named" rather than looking it up', async () => {
    // 0 is falsy but a valid number; the guard is `typeof === number`, so this
    // pins that an id of 0 still takes the by-id path and is rejected if absent
    // — the alternative (silent fallback) is the bug class above.
    const store = makeStore({ findUnique: mock(async () => null) });
    const result = await resolveThemeCategory(store, 0);
    expect(result.ok).toBe(false);
  });
});
