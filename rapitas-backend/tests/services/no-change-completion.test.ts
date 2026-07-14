/**
 * isNoChangeCompletion テスト (task 485 回帰)
 *
 * 「変更なし＝実装済みなのでPRなしで完了してよい」の判定が、
 * base ブランチ不在による gh エラーや実変更ありのコミットを
 * 誤って no-change 扱いしないことを固定する。
 */
import { describe, test, expect } from 'bun:test';
import { isNoChangeCompletion } from '../../routes/workflow/workflow-auto-commit';

describe('isNoChangeCompletion', () => {
  test('本当に変更が無い場合は true（nothing to commit）', () => {
    expect(
      isNoChangeCompletion({
        errorBlob: 'nothing to commit, working tree clean',
        filesChanged: undefined,
      }),
    ).toBe(true);
  });

  test('コミットは出来たが base に対して差分ゼロ（既実装）は true', () => {
    expect(
      isNoChangeCompletion({
        errorBlob: 'pull request create failed: No commits between develop and feature/x',
        filesChanged: 0,
      }),
    ).toBe(true);
  });

  test('filesChanged=0 はエラー文言に依らず true', () => {
    expect(isNoChangeCompletion({ errorBlob: '', filesChanged: 0 })).toBe(true);
  });

  test('base ブランチ不在エラーは false（task 485: 存在しないbaseも No commits between を出す）', () => {
    expect(
      isNoChangeCompletion({
        errorBlob:
          "pull request create failed: GraphQL: Head sha can't be blank, Base sha can't be blank, No commits between develop and feature/implement-uiux, Base ref must be a branch (createPullRequest)",
        filesChanged: 5,
      }),
    ).toBe(false);
  });

  test('base 系エラーは filesChanged 不明でも false', () => {
    expect(
      isNoChangeCompletion({
        errorBlob: 'Base ref must be a branch, No commits between develop and feature/x',
        filesChanged: undefined,
      }),
    ).toBe(false);
  });

  test('実変更がコミットされていれば no-change 文言があっても false', () => {
    expect(
      isNoChangeCompletion({
        errorBlob: 'No commits between main and feature/y',
        filesChanged: 5,
      }),
    ).toBe(false);
  });

  test('無関係な PR エラー（認証等）は false', () => {
    expect(
      isNoChangeCompletion({ errorBlob: 'gh: authentication failed', filesChanged: undefined }),
    ).toBe(false);
  });
});
