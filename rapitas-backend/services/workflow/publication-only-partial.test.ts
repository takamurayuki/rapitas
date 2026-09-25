/**
 * publication-only-partial テスト
 *
 * `⚠️ 一部失敗` の理由が push / CI / merge の未実施だけなら合格扱いにできること、
 * 実失敗・未実装・❌ 判定・非ゼロの失敗集計があれば従来どおり差し戻すことを検証する。
 */
import { describe, expect, test } from 'bun:test';
import { isPublicationOnlyPartial } from './publication-only-partial';
import { validateVerify } from './phase-output-validator';

const report = (
  verdict: string,
  remaining: string,
  tests = '26/26 pass, 0 fail (exit 0)',
) => `# 検証レポート

## 検証結果サマリ

${verdict} — 技術検証は全て通過。

| 項目 | 値 |
| --- | --- |
| 全体判定 | ${verdict} |
| テスト通過率 | 100% |

## テスト結果

${tests}

## チェックリスト消化状況

- ✅ 受入条件 1
- ✅ 受入条件 2

## 残課題 / フォローアップ

${remaining}
`;

describe('isPublicationOnlyPartial', () => {
  test('push / CI / merge の未実施だけを残課題にした一部失敗は公開待ちとみなす', () => {
    const md = report(
      '⚠️ 一部失敗',
      '| # | 内容 | 重要度 | 推奨対応 |\n| --- | --- | --- | --- |\n| 1 | push・CI・merge は未実施(pending) | 低 | 公開後に確認 |',
    );
    expect(isPublicationOnlyPartial(md)).toBe(true);
    expect(validateVerify(md).ok).toBe(true);
  });

  test('箇条書きの残課題でも同じ', () => {
    const md = report(
      '⚠️ 一部失敗',
      '- 公開ゲート（push / CI / merge）は未着手（保留、watcher が実行）',
    );
    expect(isPublicationOnlyPartial(md)).toBe(true);
  });

  test('未実装・不足の項目が混ざれば従来どおり差し戻す', () => {
    const md = report(
      '⚠️ 一部失敗',
      '- push / CI / merge は未実施\n- 統合テストが未実装（計画の項目 7）',
    );
    expect(isPublicationOnlyPartial(md)).toBe(false);
    expect(validateVerify(md).ok).toBe(false);
  });

  test('❌ 検証失敗は公開待ちの記述があっても差し戻す', () => {
    const md = report('❌ 検証失敗', '- push / CI / merge は未実施');
    expect(isPublicationOnlyPartial(md)).toBe(false);
    expect(validateVerify(md).ok).toBe(false);
  });

  test('非ゼロの失敗集計があれば差し戻す', () => {
    const md = report('⚠️ 一部失敗', '- push / CI / merge は未実施', '24/26 pass, 2 fail (exit 1)');
    expect(isPublicationOnlyPartial(md)).toBe(false);
  });

  test('残課題に CI 失敗そのものが書かれていれば差し戻す', () => {
    const md = report('⚠️ 一部失敗', '- PR #744 の CI「行数上限」が失敗中');
    expect(isPublicationOnlyPartial(md)).toBe(false);
  });

  test('残課題セクションが無ければ判断せず差し戻す', () => {
    const md = `# 検証レポート\n## 検証結果サマリ\n| 全体判定 | ⚠️ 一部失敗 |\n## テスト結果\n10/10 pass\n## チェックリスト消化状況\n- ✅ a\n`;
    expect(isPublicationOnlyPartial(md)).toBe(false);
  });
});
