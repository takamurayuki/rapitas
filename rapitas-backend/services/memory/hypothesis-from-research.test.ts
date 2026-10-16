/**
 * extractResearchHypotheses テスト
 *
 * research.md の `## 仮説` セクション抽出ロジックの純粋部分を検証する。
 */
import { describe, test, expect } from 'bun:test';
import { extractResearchHypotheses } from './hypothesis-from-research';

describe('extractResearchHypotheses', () => {
  test('`## 仮説` 配下の `- [domain] 主張` を抽出し domain を正規化する', () => {
    const md = [
      '# research',
      '## 所見',
      '- 何か',
      '## 仮説',
      '- [performance] git-exec キャッシュで PR 取得の往復が減る',
      '- [codebase] env-validation は TTL を集中管理していない',
      '## 次のステップ',
      '- [architecture] これは別セクションなので無視される',
    ].join('\n');
    const out = extractResearchHypotheses(md);
    expect(out.length).toBe(2);
    expect(out[0]!.domain).toBe('performance');
    expect(out[0]!.statement).toContain('git-exec');
    expect(out[1]!.domain).toBe('codebase');
  });

  test('domain 省略時は正規化のデフォルトに落ちる', () => {
    const md = '## Hypotheses\n- worktree 共有で pod 起動が短縮される見込み';
    const out = extractResearchHypotheses(md);
    expect(out.length).toBe(1);
    expect(typeof out[0]!.domain).toBe('string');
  });

  test('質問形 / 12文字未満は除外する', () => {
    const md = [
      '## 仮説',
      '- [codebase] これは本当に正しいのか？', // 質問形 → 除外
      '- [codebase] 短い', // 12文字未満 → 除外
      '- [performance] 十分に長い反証可能な主張をここに記述する',
    ].join('\n');
    const out = extractResearchHypotheses(md);
    expect(out.length).toBe(1);
    expect(out[0]!.domain).toBe('performance');
  });

  test('仮説セクションが無ければ空配列', () => {
    expect(extractResearchHypotheses('# research\n## 所見\n- なし')).toEqual([]);
    expect(extractResearchHypotheses('')).toEqual([]);
    expect(extractResearchHypotheses(null)).toEqual([]);
  });

  test('最大6件で打ち切る', () => {
    const lines = ['## 仮説'];
    for (let i = 0; i < 10; i++)
      lines.push(`- [codebase] 反証可能な十分長い主張 番号${i} を記述する`);
    expect(extractResearchHypotheses(lines.join('\n')).length).toBe(6);
  });
});
