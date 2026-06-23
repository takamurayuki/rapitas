/**
 * type-guards
 *
 * Generic type-guard and enum-narrowing utilities. Provides a cast-free SSOT
 * for the `includes(value as T)` double-cast pattern that appears across
 * multiple services. Consumers should import directly from this file to avoid
 * expanding the barrel's module graph in test environments.
 */

/**
 * Returns true when `value` is a string that belongs to the `allowed` tuple.
 * Acts as a TypeScript type predicate so callers get automatic narrowing.
 *
 * @param value - Value of unknown type to test. / 検査する値（型不明）
 * @param allowed - Readonly array of valid enum members. / 有効な列挙値の読み取り専用配列
 * @returns `true` when value is a member of allowed. / allowedの要素の場合true
 */
export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.some((a) => a === value);
}

/**
 * Narrows an unknown value to an enum member, returning `fallback` when
 * the value is absent, non-string, or not in `allowed`.
 *
 * @param value - Raw value to narrow (e.g. from DB or HTTP input). / 正規化対象の生の値
 * @param allowed - Readonly array of valid enum members. / 有効な列挙値の配列
 * @param fallback - Default value returned when `value` is invalid. / 無効値のときに返すデフォルト値
 * @returns A valid enum member. / 有効な列挙値
 */
export function narrowEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return isOneOf(value, allowed) ? value : fallback;
}

/**
 * Narrows an unknown value to an enum member, returning `null` when
 * the value is absent, non-string, or not in `allowed`.
 *
 * @param value - Raw value to narrow (e.g. from DB or HTTP input). / 正規化対象の生の値
 * @param allowed - Readonly array of valid enum members. / 有効な列挙値の配列
 * @returns A valid enum member, or `null` when value is invalid. / 有効な列挙値、または無効なときnull
 */
export function narrowEnumOrNull<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return isOneOf(value, allowed) ? value : null;
}
