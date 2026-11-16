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
  findFirst(args: {
    where: { name?: string; isDefault?: boolean; mode?: string };
    orderBy?: Array<{ sortOrder?: 'asc' } | { id?: 'asc' }>;
  }): Promise<CategoryLike | null>;
  count(): Promise<number>;
  create(args: { data: { name: string; mode: string; isDefault: boolean } }): Promise<CategoryLike>;
}

/** Either the resolved category, or the reason the request must be rejected. */
export type CategoryResolution =
  | { ok: true; category: CategoryLike; isDevelopment: boolean }
  | { ok: false; error: string; code: CategoryRejectionCode };

/**
 * Machine-readable rejection reason, so the wizard can show a localized hint
 * instead of the Japanese `error` prose.
 */
export type CategoryRejectionCode = 'category_not_found' | 'category_required';

/** Name/mode of the category used when the caller does not name one. */
export const FALLBACK_CATEGORY = { name: '開発', mode: 'development' } as const;

/** Rejection returned when no category is named and no development category exists. */
export const NO_FALLBACK_CATEGORY_ERROR =
  '開発モードのカテゴリがありません。カテゴリを選択してから作成してください';

/**
 * Resolve the category for a new scaffolded theme.
 *
 * The caller's choice wins. A named id is VALIDATED rather than trusted — a
 * stale id from the UI would otherwise create a theme pointing at a category
 * that no longer exists.
 *
 * With no id, the fallback is, in order: the default 開発 category, then the
 * first other development-mode category. 開発 is re-created only when the
 * table is completely empty (first run, same rule as POST
 * /categories/seed-defaults). If categories exist but none is development
 * mode, the request is rejected so the caller picks one: the user deleted 開発
 * on purpose, and silently filing a code project under e.g. 学習 would also
 * clear isDevelopment and drop it out of auto-run.
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
    if (!chosen) {
      return {
        ok: false,
        error: `categoryId ${categoryId} は存在しません`,
        code: 'category_not_found',
      };
    }
    return resolved(chosen);
  }

  const existing = await store.findFirst({
    where: { name: FALLBACK_CATEGORY.name, isDefault: true },
  });
  if (existing) return resolved(existing);

  const anyDevelopment = await store.findFirst({
    where: { mode: FALLBACK_CATEGORY.mode },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  if (anyDevelopment) return resolved(anyDevelopment);

  // NOTE: Re-creating 開発 once the user has other categories would undo their
  // deletion — only an empty table counts as "not seeded yet".
  if ((await store.count()) > 0) {
    return { ok: false, error: NO_FALLBACK_CATEGORY_ERROR, code: 'category_required' };
  }

  const created = await store.create({
    data: { name: FALLBACK_CATEGORY.name, mode: FALLBACK_CATEGORY.mode, isDefault: true },
  });
  return resolved(created);
}

function resolved(category: CategoryLike): CategoryResolution {
  return { ok: true, category, isDevelopment: category.mode === 'development' };
}
