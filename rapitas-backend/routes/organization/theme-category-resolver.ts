/**
 * theme-category-resolver
 *
 * Decides which Category a scaffolded theme belongs to, and whether that makes
 * it a development theme. NOT responsible for creating the theme row or the
 * project directory — themes.ts owns those.
 *
 * Split out of themes.ts so the decision is unit-testable without mocking the
 * git/filesystem work that surrounds it in setup-from-claude-md (and to keep
 * that file under its line limit).
 */

/** The subset of a Category row this decision needs. */
export interface CategoryLike {
  id: number;
  name: string;
  mode: string;
}

/** The Prisma surface this resolver touches, narrowed for testability. */
export interface CategoryStore {
  findUnique(args: { where: { id: number } }): Promise<CategoryLike | null>;
  findFirst(args: { where: { name: string; isDefault: boolean } }): Promise<CategoryLike | null>;
  create(args: { data: { name: string; mode: string; isDefault: boolean } }): Promise<CategoryLike>;
}

/** Either the resolved category, or the reason the request must be rejected. */
export type CategoryResolution =
  | { ok: true; category: CategoryLike; isDevelopment: boolean }
  | { ok: false; error: string };

/** Name/mode of the category used when the caller does not name one. */
export const FALLBACK_CATEGORY = { name: '開発', mode: 'development' } as const;

/**
 * Resolve the category for a new scaffolded theme.
 *
 * The caller's choice wins; 開発 is only the fallback for a request that names
 * none, which is what the wizard sent before the picker existed. A named id is
 * VALIDATED rather than trusted — a stale id from the UI would otherwise create
 * a theme pointing at a category that no longer exists.
 *
 * `isDevelopment` follows the category's mode rather than being hardcoded true:
 * the flag gates auto-run eligibility, so a theme filed under a non-development
 * category must not be swept into the agent workflow.
 *
 * @param store - Category table accessor. / カテゴリテーブルへのアクセス
 * @param categoryId - Caller's chosen category, if any. / 呼び出し側が選んだカテゴリ
 * @returns The resolved category and development flag, or a rejection reason. / 解決結果
 */
export async function resolveThemeCategory(
  store: CategoryStore,
  categoryId?: number,
): Promise<CategoryResolution> {
  if (typeof categoryId === 'number') {
    const chosen = await store.findUnique({ where: { id: categoryId } });
    if (!chosen) return { ok: false, error: `categoryId ${categoryId} は存在しません` };
    return { ok: true, category: chosen, isDevelopment: chosen.mode === 'development' };
  }

  const existing = await store.findFirst({
    where: { name: FALLBACK_CATEGORY.name, isDefault: true },
  });
  if (existing) {
    return { ok: true, category: existing, isDevelopment: existing.mode === 'development' };
  }

  const created = await store.create({
    data: { name: FALLBACK_CATEGORY.name, mode: FALLBACK_CATEGORY.mode, isDefault: true },
  });
  return { ok: true, category: created, isDevelopment: created.mode === 'development' };
}
