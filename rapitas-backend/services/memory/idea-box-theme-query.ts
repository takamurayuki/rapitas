/**
 * idea-box-theme-query
 *
 * Parses the `themeId` query parameter of GET /idea-box. A numeric value pins one
 * theme (unchanged behaviour); the literal 'none' selects only ideas without a theme.
 * It does not build the Prisma where clause (see idea-box-service buildWhereClause).
 */

/** Query value of `themeId` meaning "ideas with no theme only". */
export const IDEA_NO_THEME_QUERY = 'none';

/**
 * Interpret the raw `themeId` query string.
 *
 * @param raw - Raw query value / クエリの生の値
 * @returns themeId for a numeric value, noTheme=true for 'none' / 数値ならthemeId、'none'ならnoTheme
 */
export function parseIdeaThemeQuery(raw: string | undefined): {
  themeId: number | undefined;
  noTheme: boolean;
} {
  if (raw === IDEA_NO_THEME_QUERY) return { themeId: undefined, noTheme: true };
  // NOTE: Same parsing as before 'none' existed — non-numeric values stay NaN and filter nothing.
  return { themeId: raw ? parseInt(raw) : undefined, noTheme: false };
}
