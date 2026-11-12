/**
 * idea-box-theme-query tests
 *
 * GET /idea-box の themeId クエリの解釈（数値＝そのテーマ、'none'＝テーマなしのみ）を確認する。
 */
import { describe, test, expect } from 'bun:test';
import { IDEA_NO_THEME_QUERY, parseIdeaThemeQuery } from './idea-box-theme-query';

describe('parseIdeaThemeQuery', () => {
  test("'none' はテーマなしのみ（themeId は付けない）", () => {
    expect(IDEA_NO_THEME_QUERY).toBe('none');
    expect(parseIdeaThemeQuery('none')).toEqual({ themeId: undefined, noTheme: true });
  });

  test('数値の themeId は従来どおりそのテーマ', () => {
    expect(parseIdeaThemeQuery('7')).toEqual({ themeId: 7, noTheme: false });
  });

  test('未指定・空文字は従来どおり絞らない', () => {
    expect(parseIdeaThemeQuery(undefined)).toEqual({ themeId: undefined, noTheme: false });
    expect(parseIdeaThemeQuery('')).toEqual({ themeId: undefined, noTheme: false });
  });
});
