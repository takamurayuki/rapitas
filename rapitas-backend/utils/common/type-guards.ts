/**
 * type-guards
 *
 * Generic factory for string-union type guards and narrowing functions.
 * All domain-specific is/narrow functions in services should derive from
 * makeStringTypeGuard to eliminate unsafe `as T` casts on DB-sourced strings.
 */

/**
 * Creates a type-safe is-guard and narrowing function pair for a string union type T.
 * Internally uses a Set for O(1) membership checks.
 *
 * @param values - Readonly array of all valid values for type T. / 型Tの全有効値の配列
 * @returns Object with `is` (type predicate) and `narrow` (safe coercion) closures. / 型述語と安全な強制変換のクロージャを持つオブジェクト
 *
 * @example
 * const { is: isStatus, narrow: narrowStatus } = makeStringTypeGuard(['active', 'inactive'] as const);
 * narrowStatus(dbRow.status, 'inactive'); // safe, never throws
 */
export function makeStringTypeGuard<T extends string>(values: readonly T[]) {
  // NOTE: Set gives O(1) lookup vs Array.includes O(n); consistent across all domain sizes.
  const set = new Set<string>(values);

  // NOTE: `is` and `narrow` are plain closures that capture `set` directly and never
  // reference `this`, so they remain correct after destructuring:
  //   const { narrow } = makeStringTypeGuard(STATUSES)  ← safe
  const is = (s: unknown): s is T => typeof s === 'string' && set.has(s);
  const narrow = (s: string | null | undefined, fallback: T): T => (is(s) ? s : fallback);

  return { is, narrow };
}
